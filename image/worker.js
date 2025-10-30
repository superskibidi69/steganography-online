// Image processing worker: normalize, encode, decode
self.onmessage = function(e) {
  var msg = e.data;
  try {
    if (msg.action === 'encode') {
      var width = msg.width;
      var height = msg.height;
      var pixels = new Uint8ClampedArray(msg.imageData);
      var messageBytes = msg.messageBytes;
      var totalPixels = pixels.length / 4;

      // Normalize LSBs
      for (var p = 0; p < pixels.length; p += 4) {
        for (var o = 0; o < 3; o++) {
          if (pixels[p + o] % 2 !== 0) pixels[p + o]--;
        }
        if ((p & 65535) === 0) {
          // report progress occasionally
          var pct = Math.min(50, Math.floor((p / pixels.length) * 50));
          self.postMessage({type: 'progress', progress: pct});
        }
      }

      // Encode message bits into LSBs
      var bitIdx = 0;
      var totalBits = messageBytes.length * 8;
      for (var i = 0, idx = 0; i < totalPixels && bitIdx < totalBits; i++, idx += 4) {
        for (var off = 0; off < 3 && bitIdx < totalBits; off++) {
          var byteIndex = (bitIdx / 8) | 0;
          var bitInByte = 7 - (bitIdx & 7);
          var bit = (messageBytes[byteIndex] >> bitInByte) & 1;
          pixels[idx + off] = (pixels[idx + off] & 0xFE) | bit;
          bitIdx++;
        }
        if ((i & 16383) === 0) {
          var pct2 = 50 + Math.floor((i / totalPixels) * 50);
          self.postMessage({type: 'progress', progress: pct2});
        }
      }

      // return modified buffer
      self.postMessage({type: 'done', imageData: pixels.buffer}, [pixels.buffer]);
    }
    else if (msg.action === 'decode') {
      var pixels = new Uint8ClampedArray(msg.imageData);
      var totalPixels = pixels.length / 4;
      var bits = [];
      for (var i = 0, idx = 0; i < totalPixels; i++, idx += 4) {
        bits.push(pixels[idx] & 1, pixels[idx+1] & 1, pixels[idx+2] & 1);
        if ((i & 16383) === 0) {
          var p = Math.floor((i / totalPixels) * 100);
          self.postMessage({type: 'progress', progress: p});
        }
      }

      var out = [];
      for (var bi = 0; bi + 7 < bits.length; bi += 8) {
        var c = 0;
        for (var j = 0; j < 8; j++) c = (c << 1) | bits[bi + j];
        out.push(String.fromCharCode(c));
      }
      var output = out.join('');
      self.postMessage({type: 'done-decode', text: output});
    }
  } catch (err) {
    self.postMessage({type: 'error', message: err && err.message ? err.message : String(err)});
  }
};
