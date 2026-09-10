const fs = require('fs');
const path = require('path');

const size = 64;
const outputDirectory = path.join(__dirname, '..', 'assets', 'luts');
const presets = ['bright'];
const encode = value => value <= .0031308 ? value * 12.92 : 1.055 * Math.pow(Math.max(0,value),1/2.4)-.055;
function transform(rgb, preset) {
  if (preset === 'bright') return rgb.map(value => {
    const linear = value <= .04045 ? value / 12.92 : Math.pow((value + .055) / 1.055, 2.4);
    const boosted = linear * 2.03;
    return encode(boosted <= .7 ? boosted : .7 + .3 * (1 - Math.exp(-(boosted - .7) / .3)));
  });
  return rgb.slice();
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

