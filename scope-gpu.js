// Floating-point scope accumulation. No temporal persistence or fabricated connecting lines.
window.createScopeGpu = () => {
  const canvas=document.createElement('canvas');
  const gl=canvas.getContext('webgl2',{alpha:true,premultipliedAlpha:false,preserveDrawingBuffer:true,antialias:false});
  if(!gl || !gl.getExtension('EXT_color_buffer_float') || !gl.getExtension('EXT_float_blend'))return null;
  const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
  const program=(vs,fs)=>{const p=gl.createProgram();const v=shader(gl.VERTEX_SHADER,vs),f=shader(gl.FRAGMENT_SHADER,fs);gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);gl.deleteShader(v);gl.deleteShader(f);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;};
  const points=program(`#version 300 es
precision highp float;
uniform sampler2D source;uniform int mode;uniform vec2 outputSize;
out vec3 color;out vec2 center;
void main(){
 ivec2 size=textureSize(source,0);int count=size.x*size.y;
 int channel=gl_VertexID/count;int i=gl_VertexID%count;
 vec3 rgb=texelFetch(source,ivec2(i%size.x,i/size.x),0).rgb;
 float luma=dot(rgb,vec3(.2126,.7152,.0722));
 float x=(float(i%size.x)+.5)/float(size.x);float y=luma;
 color=vec3(1.);
 if(mode==3){x=.5+(rgb.b-luma)/1.8556*.9;y=.5+(rgb.r-luma)/1.5748*.9;color=rgb/max(max(rgb.r,rgb.g),max(rgb.b,.001));}
 else if(mode!=0){y=rgb[channel];color=vec3(0.);color[channel]=1.;if(mode==2)x=(float(channel)+x)/3.;}
 center=vec2(.5)+vec2(x,y)*(outputSize-1.);
 gl_Position=vec4(center/outputSize*2.-1.,0.,1.);gl_PointSize=3.;
}`,`#version 300 es
precision highp float;
in vec3 color;in vec2 center;out vec4 result;
void main(){vec2 d=abs(gl_FragCoord.xy-center);float w=max(0.,1.-d.x)*max(0.,1.-d.y);result=vec4(color*w,w);}`);
  const finish=program(`#version 300 es
precision highp float;
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}`,`#version 300 es
precision highp float;
uniform sampler2D density;uniform float exposure;out vec4 result;
void main(){vec3 energy=texelFetch(density,ivec2(gl_FragCoord.xy),0).rgb;vec3 light=1.-exp(-energy*exposure);float a=max(light.r,max(light.g,light.b));result=vec4(a>0.?light/a:vec3(0.),a);}`);
  const texture=()=>{const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return t;};
  const input=texture(),density=texture(),fb=gl.createFramebuffer();let width=0,height=0,inputWidth=0,inputHeight=0,lastRevision=null,lastMode=-1,lastSource=null;
  const stats={renders:0,uploads:0,allocations:0,accumulations:0,cacheHits:0,lastSubmitMs:0,totalSubmitMs:0};
  const locations={source:gl.getUniformLocation(points,'source'),mode:gl.getUniformLocation(points,'mode'),size:gl.getUniformLocation(points,'outputSize'),density:gl.getUniformLocation(finish,'density'),exposure:gl.getUniformLocation(finish,'exposure')};
  return {getStats:()=>({...stats}),render(source,mode,w,h,gain,revision){
    const started=performance.now();
    if(gl.isContextLost())throw Error('Scope GPU context lost');
    w=Math.max(2,Math.round(w));h=Math.max(2,Math.round(h));
    const resized=w!==width||h!==height;
    const upload=revision===undefined||source!==lastSource||revision!==lastRevision||source.width!==inputWidth||source.height!==inputHeight;
    const accumulate=upload||resized||mode!==lastMode;
    gl.activeTexture(gl.TEXTURE0);
    if(w!==width||h!==height){width=w;height=h;canvas.width=w;canvas.height=h;gl.bindTexture(gl.TEXTURE_2D,density);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,w,h,0,gl.RGBA,gl.FLOAT,null);gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,density,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Scope float framebuffer unavailable');}
    gl.viewport(0,0,w,h);
    if(upload){
      gl.bindTexture(gl.TEXTURE_2D,input);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
      if(inputWidth!==source.width||inputHeight!==source.height){
        inputWidth=source.width;inputHeight=source.height;
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,inputWidth,inputHeight,0,gl.RGBA,gl.UNSIGNED_BYTE,null);stats.allocations++;
      }
      gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,source);stats.uploads++;
    }
    const count=source.width*source.height;
    if(accumulate){
      gl.bindTexture(gl.TEXTURE_2D,input);gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);gl.useProgram(points);gl.uniform1i(locations.source,0);gl.uniform1i(locations.mode,mode);gl.uniform2f(locations.size,w,h);
      gl.drawArrays(gl.POINTS,0,count*(mode===1||mode===2?3:1));stats.accumulations++;
    }else stats.cacheHits++;
    gl.disable(gl.BLEND);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.clear(gl.COLOR_BUFFER_BIT);gl.bindTexture(gl.TEXTURE_2D,density);gl.useProgram(finish);gl.uniform1i(locations.density,0);
    gl.uniform1f(locations.exposure,gain*(mode===3? .22*w*h/count : .3*288*w/count));gl.drawArrays(gl.TRIANGLES,0,3);
    lastSource=source;lastRevision=revision;lastMode=mode;
    stats.renders++;stats.lastSubmitMs=performance.now()-started;stats.totalSubmitMs+=stats.lastSubmitMs;
    return canvas;
  }};
};
