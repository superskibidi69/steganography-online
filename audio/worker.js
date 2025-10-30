// Audio worker: writes/reads LSBs into WAV ArrayBuffer
self.onmessage = function(e) {
  var msg = e.data;
  try {
    if (msg.action === 'encode') {
      var buf = msg.buffer;
      var info = msg.info; // {dataOffset, bytesPerSample, sampleCount}
      var messageBytes = msg.messageBytes; // Uint8Array
      var out = new Uint8Array(buf);

      var dataOffset = info.dataOffset;
      var bytesPerSample = info.bytesPerSample;
      var sampleCount = info.sampleCount;

      var bitIdx = 0;
      function writeBit(bit) {
        var s = bitIdx;
        var byteIndex = dataOffset + (s * bytesPerSample);
        out[byteIndex] = (out[byteIndex] & 0xFE) | (bit & 1);
        bitIdx++;
      }

      var totalBits = messageBytes.length * 8;
      // header + message already prepared by main thread (if provided as messageBytes includes header)
      for (var mb = 0; mb < messageBytes.length; mb++) {
        var b = messageBytes[mb];
        for (var k = 7; k >= 0; k--) {
          writeBit((b >> k) & 1);
        }
        if ((mb & 1023) === 0) {
          self.postMessage({type: 'progress', progress: Math.floor((mb / messageBytes.length) * 100)});
        }
      }

      self.postMessage({type: 'done', buffer: out.buffer}, [out.buffer]);
    }
    else if (msg.action === 'decode') {
      var buf = msg.buffer;
      var info = msg.info; // {dataOffset, bytesPerSample, sampleCount}
      var dv = new DataView(buf);
      var bytesPerSample = info.bytesPerSample;
      var sampleCount = info.sampleCount;

      function readBitAt(sampleIndex) {
        var byteIndex = info.dataOffset + (sampleIndex * bytesPerSample);
        return dv.getUint8(byteIndex) & 1;
      }

      // Read header
      var headerVal = 0 >>> 0;
      if (sampleCount >= 32) {
        for (var h = 0; h < 32; h++) headerVal = ((headerVal << 1) | readBitAt(h)) >>> 0;
        var declaredLen = headerVal >>> 0;
        var maxPayloadBytes = Math.floor((sampleCount - 32) / 8);
        if (declaredLen <= maxPayloadBytes) {
          var out = [];
          var startBit = 32;
          for (var bi = 0; bi < declaredLen; bi++) {
            var c = 0;
            for (var b2 = 0; b2 < 8; b2++) c = (c << 1) | readBitAt(startBit + bi * 8 + b2);
            out.push(String.fromCharCode(c));
            if ((bi & 1023) === 0) self.postMessage({type: 'progress', progress: Math.floor((bi / declaredLen) * 100)});
          }
          self.postMessage({type: 'done-decode', text: out.join('')});
          return;
        }
      }

      // Fallback: read whole stream
      var totalBytes = Math.floor(sampleCount / 8);
      var out2 = [];
      for (var bi2 = 0; bi2 < totalBytes; bi2++) {
        var c2 = 0;
        for (var b3 = 0; b3 < 8; b3++) c2 = (c2 << 1) | readBitAt(bi2 * 8 + b3);
        out2.push(String.fromCharCode(c2));
        if ((bi2 & 1023) === 0) self.postMessage({type: 'progress', progress: Math.floor((bi2 / totalBytes) * 100)});
      }
      var output2 = out2.join('').replace(/\x00+$/g, '');
      self.postMessage({type: 'done-decode', text: output2});
    }
  } catch (err) {
    self.postMessage({type: 'error', message: err && err.message ? err.message : String(err)});
  }
};
