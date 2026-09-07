const fs=require('fs'),path=require('path'),cp=require('child_process');
const src='.cache/sources', sdk=path.resolve('.cache/sdk');fs.mkdirSync(sdk,{recursive:true});
fs.cpSync(src+'/FFmpeg-n6.1.1',sdk+'/include',{recursive:true,filter:p=>fs.statSync(p).isDirectory()||p.endsWith('.h')});
fs.cpSync(src+'/libplacebo-6.338.2/src/include/libplacebo',sdk+'/include/libplacebo',{recursive:true});
fs.cpSync(src+'/libass-0.17.4/libass',sdk+'/include/ass',{recursive:true});
fs.writeFileSync(sdk+'/include/libavutil/avconfig.h','#define AV_HAVE_BIGENDIAN 0\n#define AV_HAVE_FAST_UNALIGNED 1\n');
let config=fs.readFileSync(sdk+'/include/libplacebo/config.h.in','utf8').replace('@majorver@','6').replace('@apiver@','338').replace('@extra_defs@','#define PL_HAVE_OPENGL 1\n#define PL_HAVE_VULKAN 1');fs.writeFileSync(sdk+'/include/libplacebo/config.h',config);
const vs=cp.execFileSync(path.join(process.env['ProgramFiles(x86)'],'Microsoft Visual Studio/Installer/vswhere.exe'),['-latest','-products','*','-property','installationPath'],{encoding:'utf8'}).trim();
const versions=fs.readdirSync(path.join(vs,'VC/Tools/MSVC')).sort();const tools=path.join(vs,'VC/Tools/MSVC',versions.at(-1),'bin/Hostx64/x64')+'/';
const deps={libavcodec:['avcodec-60.dll','60.31.102'],libavfilter:['avfilter-9.dll','9.12.100'],libavformat:['avformat-60.dll','60.16.100'],libavutil:['avutil-58.dll','58.29.100'],libswresample:['swresample-4.dll','4.12.100'],libswscale:['swscale-7.dll','7.5.100'],libplacebo:['libplacebo-338.dll','6.338.2'],libass:['libass-9.dll','0.17.4']};
let overrides="sdk_cc = meson.get_compiler('c')\n";
for(const [name,[dll,version]] of Object.entries(deps)){
 const output=cp.execFileSync(tools+'dumpbin.exe',['/exports',path.resolve('.cache/libmpv/bin',dll)],{encoding:'utf8'});
 const exports=output.split('\n').map(l=>l.match(/^\s+\d+\s+[0-9A-F]+\s+[0-9A-F]+\s+(\w+)/)?.[1]).filter(Boolean);
 fs.writeFileSync(sdk+'/'+name+'.def','LIBRARY '+dll+'\nEXPORTS\n'+exports.join('\n'));
 cp.execFileSync(tools+'lib.exe',['/def:'+sdk+'/'+name+'.def','/out:'+sdk+'/'+name+'.lib','/machine:x64']);
 overrides+=`meson.override_dependency('${name}', declare_dependency(include_directories: include_directories('${sdk.replaceAll('\\','/')}/include'), dependencies: sdk_cc.find_library('${name}', dirs: '${sdk.replaceAll('\\','/')}'), version: '${version}'))\n`;
}
const file=src+'/mpv-0.41.0/meson.build';let meson=fs.readFileSync(file,'utf8');meson=meson.replace(/sdk_cc = meson\.get_compiler\('c'\)[\s\S]*?# ffmpeg/,'# ffmpeg');meson=meson.replace('# ffmpeg',overrides+'\n# ffmpeg').replace("['--codepage=65001']","['/c65001']");fs.writeFileSync(file,meson);

fs.writeFileSync(sdk+'/include/libavutil/ffversion.h','#define FFMPEG_VERSION "6.1.1"\n');
fs.copyFileSync('native/core-patches/astria_sdr.h',src+'/mpv-0.41.0/video/out/astria_sdr.h');
const swFile=src+'/mpv-0.41.0/video/out/libmpv_sw.c';let sw=fs.readFileSync(swFile,'utf8');if(!sw.includes('astria_sdr.h'))sw=sw.replace('#include "video/sws_utils.h"','#include "video/sws_utils.h"\n#include "astria_sdr.h"');sw=sw.replace('mp_sws_scale(p->sws, &dst, &src)','astria_sdr_scale(p->sws, &dst, &src)');fs.writeFileSync(swFile,sw);
