/* Astria software output extension for mpv v0.41.0.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 * Uses libplacebo's BT.2390 EETF and color-primary adaptation, preserving
 * floating point EXR and HDR values until the final Rec.709/BT.1886 encoding.
 */
#include <math.h>
#include <libplacebo/tone_mapping.h>

static float astria_linear(float v, enum pl_color_transfer transfer)
{
    v = fmaxf(v, 0.0f);
    switch (transfer) {
    case PL_COLOR_TRC_LINEAR: return v;
    case PL_COLOR_TRC_PQ: return pl_hdr_rescale(PL_HDR_PQ, PL_HDR_NITS, v) / 100.0f;
    case PL_COLOR_TRC_HLG:
        return v <= 0.5f ? v * v / 3.0f : (expf((v - 0.55991073f) / 0.17883277f) + 0.28466892f) / 12.0f;
    case PL_COLOR_TRC_SRGB: return v <= 0.04045f ? v / 12.92f : powf((v + 0.055f) / 1.055f, 2.4f);
    case PL_COLOR_TRC_GAMMA18: return powf(v, 1.8f);
    case PL_COLOR_TRC_GAMMA20: return v * v;
    case PL_COLOR_TRC_GAMMA22: return powf(v, 2.2f);
    case PL_COLOR_TRC_GAMMA26: return powf(v, 2.6f);
    case PL_COLOR_TRC_GAMMA28: return powf(v, 2.8f);
    case PL_COLOR_TRC_PRO_PHOTO: return v <= 0.03125f ? v / 16.0f : powf(v, 1.8f);
    default: return powf(v, 2.4f);
    }
}

static int astria_sdr_scale(struct mp_sws_context *sws, struct mp_image *dst, struct mp_image *src)
{
    struct pl_color_space color = src->params.color;
    pl_color_space_infer(&color);
    if (color.primaries == PL_COLOR_PRIM_BT_709 && color.transfer == PL_COLOR_TRC_BT_1886)
        return mp_sws_scale(sws, dst, src);
    // The bridge requests RGBA8; other clients retain upstream behavior.
    if (dst->imgfmt != mp_imgfmt_from_name(bstr0("rgba"))) return mp_sws_scale(sws, dst, src);
    struct mp_image *rgb = mp_image_alloc(mp_imgfmt_from_name(bstr0("gbrpf32")), dst->w, dst->h);
    if (!rgb) return -1;
    rgb->params.color = color;
    int result = mp_sws_scale(sws, rgb, src);
    if (result < 0) { mp_image_unrefp(&rgb); return result; }
    pl_matrix3x3 matrix = pl_get_color_mapping_matrix(pl_raw_primaries_get(color.primaries),
        pl_raw_primaries_get(PL_COLOR_PRIM_BT_709), PL_INTENT_RELATIVE_COLORIMETRIC);
    bool hdr = color.transfer == PL_COLOR_TRC_PQ || color.transfer == PL_COLOR_TRC_HLG || color.transfer == PL_COLOR_TRC_LINEAR;
    float peak = color.hdr.max_cll > 0 ? color.hdr.max_cll : color.hdr.max_luma;
    if (color.transfer == PL_COLOR_TRC_LINEAR && peak <= 100.0f) {
        peak = 100.0f;
        for (int plane=0; plane<3; plane++) for (int y=0; y<rgb->h; y++) {
            float *row=(float *)(rgb->planes[plane]+y*rgb->stride[plane]);
            for (int x=0; x<rgb->w; x++) if (isfinite(row[x])) peak=fmaxf(peak,row[x]*100.0f);
        }
    }
    if (peak <= 100.0f && hdr) peak = color.transfer == PL_COLOR_TRC_LINEAR ? 100.0f : 1000.0f;
    struct pl_tone_map_params mapping = {
        .function = &pl_tone_map_bt2390, .constants = { PL_TONE_MAP_CONSTANTS },
        .input_scaling = PL_HDR_NITS, .output_scaling = PL_HDR_NITS,
        .input_min = 0, .input_max = fmaxf(peak,100), .output_min = 0, .output_max = 100,
        .lut_size = 16384,
    };
    float lut[16384];
    if (hdr && peak > 100) pl_tone_map_generate(lut, &mapping);
    for (int y=0; y<dst->h; y++) {
        float *green=(float *)(rgb->planes[0]+y*rgb->stride[0]);
        float *blue=(float *)(rgb->planes[1]+y*rgb->stride[1]);
        float *red=(float *)(rgb->planes[2]+y*rgb->stride[2]);
        uint8_t *out=dst->planes[0]+y*dst->stride[0];
        for (int x=0; x<dst->w; x++) {
            float value[3]={astria_linear(red[x],color.transfer),astria_linear(green[x],color.transfer),astria_linear(blue[x],color.transfer)};
            if (color.transfer == PL_COLOR_TRC_HLG) {
                float luma=fmaxf(0.2627f*value[0]+0.6780f*value[1]+0.0593f*value[2],0.0f);
                float gain=powf(luma,0.2f)*peak/100.0f;
                for(int c=0;c<3;c++) value[c]*=gain;
            }
            pl_matrix3x3_apply(&matrix,value);
            float maximum=fmaxf(value[0],fmaxf(value[1],value[2]));
            if (hdr && peak > 100 && maximum > 0) {
                float index=fminf(maximum*100/peak*16383,16383); int low=(int)index;
                float mapped=lut[low]+(lut[low<16383?low+1:low]-lut[low])*(index-low);
                float gain=mapped/(maximum*100);
                for(int c=0;c<3;c++) value[c]*=gain;
            }
            // Compress out-of-gamut colors towards equal-luminance gray.
            float luma=fminf(fmaxf(0.2126f*value[0]+0.7152f*value[1]+0.0722f*value[2],0),1), saturation=1;
            for(int c=0;c<3;c++) {
                if(value[c]<0) saturation=fminf(saturation,luma/(luma-value[c]));
                if(value[c]>1) saturation=fminf(saturation,(1-luma)/(value[c]-luma));
            }
            for(int c=0;c<3;c++) {
                float linear=luma+(value[c]-luma)*saturation;
                float encoded=powf(fminf(fmaxf(linear,0),1),1.0f/2.4f);
                out[4*x+c]=isfinite(encoded)?(uint8_t)lrintf(encoded*255):0;
            }
            out[4*x+3]=255;
        }
    }
    mp_image_unrefp(&rgb); return 0;
}

