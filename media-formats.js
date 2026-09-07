(function (root) {
  'use strict';
  const video = ['mp4','m4v','mov','mkv','webm','avi','ogg','ogv','mxf','mts','m2ts','ts','vob','mpg','mpeg','wmv','asf','flv','3gp','3g2'];
  const image = ['exr','dpx','png','jpg','jpeg'];
  const formats = Object.freeze({ video: Object.freeze(video), image: Object.freeze(image),
    selectable: Object.freeze([...video, ...image]), associated: Object.freeze([...video, 'exr', 'dpx']),
    browser: Object.freeze(['mp4','m4v','mov','webm','ogv','ogg','avi','mkv']) });
  if (typeof module === 'object') module.exports = formats;
  else root.AstriaFormats = formats;
})(globalThis);
