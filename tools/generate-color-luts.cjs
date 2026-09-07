const fs = require('fs');
const path = require('path');

const size = 64;
const outputDirectory = path.join(__dirname, '..', 'assets', 'luts');
const presets = ['ue5-filmic','unity-neutral','unity-aces','acescg','aces2065'];
const matrices = {
  acescg: [1.70505,-.62179,-.08326,-.13026,1.1408,-.01055,-.024,-.12897,1.15297],
  aces2065: [2.52169,-1.13413,-.38756,-.27648,1.37272,-.09624,-.01538,-.15298,1.16835]
};
const clamp = value => Math.max(0, Math.min(1, value));
const encode = value => value <= .0031308 ? value * 12.92 : 1.055 * Math.pow(Math.max(0,value),1/2.4)-.055;
const aces = value => clamp((value*(2.51*value+.03))/(value*(2.43*value+.59)+.14));
const neutral = value => { const x=Math.max(0,value-.004); return clamp((x*(6.2*x+.5))/(x*(6.2*x+1.7)+.06)); };

function transform(rgb, preset) {
  let color = rgb.slice();
  const matrix = matrices[preset];
  if (matrix) color = [matrix[0]*color[0]+matrix[1]*color[1]+matrix[2]*color[2],matrix[3]*color[0]+matrix[4]*color[1]+matrix[5]*color[2],matrix[6]*color[0]+matrix[7]*color[1]+matrix[8]*color[2]];
  color = color.map(value => encode((preset === 'unity-neutral' ? neutral : aces)(value)));
  if (preset === 'ue5-filmic') color = color.map((value,index)=>clamp(value*(index===2?.985:1.01)));
  return color;
}

fs.mkdirSync(outputDirectory, { recursive: true });
for (const preset of presets) {
  const data = Buffer.allocUnsafe(size*size*size*4); let offset=0;
  for(let b=0;b<size;b++)for(let g=0;g<size;g++)for(let r=0;r<size;r++){
    const color=transform([r/(size-1),g/(size-1),b/(size-1)],preset);
    data[offset++]=Math.round(color[0]*255);data[offset++]=Math.round(color[1]*255);data[offset++]=Math.round(color[2]*255);data[offset++]=255;
  }
  fs.writeFileSync(path.join(outputDirectory, `${preset}-64.rgba`), data);
}

