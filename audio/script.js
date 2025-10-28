// Audio LSB script — supports 16-bit PCM WAV files
$('button.encode, button.decode, button.download').click(function(e){e.preventDefault();});

function readFileAsArrayBuffer(file){
  return new Promise((resolve,reject)=>{
    var r=new FileReader();
    r.onerror = ()=>reject(r.error);
    r.onload = ()=>resolve(r.result);
    r.readAsArrayBuffer(file);
  });
}

function findChunk(dataview, id, offset){
  offset = offset || 12; // after RIFF header
  const len = dataview.byteLength;
  while(offset + 8 <= len){
    const chunkId = String.fromCharCode(dataview.getUint8(offset)) + String.fromCharCode(dataview.getUint8(offset+1)) + String.fromCharCode(dataview.getUint8(offset+2)) + String.fromCharCode(dataview.getUint8(offset+3));
    const chunkSize = dataview.getUint32(offset+4, true);
    if(chunkId === id) return {offset: offset+8, size: chunkSize, headerOffset: offset};
    offset += 8 + chunkSize + (chunkSize % 2); // pad
  }
  return null;
}

function parseWav(arrayBuffer){
  var dv = new DataView(arrayBuffer);
  // Basic checks
  if(String.fromCharCode(dv.getUint8(0),dv.getUint8(1),dv.getUint8(2),dv.getUint8(3)) !== 'RIFF') throw new Error('Not a RIFF file');
  if(String.fromCharCode(dv.getUint8(8),dv.getUint8(9),dv.getUint8(10),dv.getUint8(11)) !== 'WAVE') throw new Error('Not a WAVE file');

  var fmt = findChunk(dv, 'fmt ');
  if(!fmt) throw new Error('fmt chunk not found');
  var audioFormat = dv.getUint16(fmt.offset, true);
  var numChannels = dv.getUint16(fmt.offset+2, true);
  var sampleRate = dv.getUint32(fmt.offset+4, true);
  var byteRate = dv.getUint32(fmt.offset+8, true);
  var blockAlign = dv.getUint16(fmt.offset+12, true);
  var bitsPerSample = dv.getUint16(fmt.offset+14, true);

  var data = findChunk(dv, 'data');
  if(!data) throw new Error('data chunk not found');

  return {
    dataview: dv,
    audioFormat: audioFormat,
    numChannels: numChannels,
    sampleRate: sampleRate,
    byteRate: byteRate,
    blockAlign: blockAlign,
    bitsPerSample: bitsPerSample,
    dataOffset: data.offset,
    dataSize: data.size
  };
}

// Ensure we obtain a 16-bit PCM WAV ArrayBuffer for any given file.
function ensureWavArrayBuffer(file){
  return readFileAsArrayBuffer(file).then(function(buf){
    try{
      var info = parseWav(buf);
      // If already 16-bit PCM, return original buffer
      if(info.audioFormat === 1 && info.bitsPerSample === 16){
        return buf;
      }
      // Otherwise fall through to decoding and re-encoding
    }catch(e){
      // Not a WAV or parse failed — we'll decode via AudioContext
    }

    // Decode with WebAudio and re-encode to 16-bit PCM WAV
    window.AudioContext = window.AudioContext || window.webkitAudioContext;
    var ac = new AudioContext();
    return ac.decodeAudioData(buf).then(function(audioBuffer){
      // encode to WAV
      var wav = encodeAudioBufferAsWav(audioBuffer);
      return wav;
    });
  });
}

function writeString(view, offset, string){
  for(var i=0;i<string.length;i++){
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function encodeAudioBufferAsWav(audioBuffer){
  var numChannels = audioBuffer.numberOfChannels;
  var sampleRate = audioBuffer.sampleRate;
  var samples = audioBuffer.length;
  var bytesPerSample = 2;
  var blockAlign = numChannels * bytesPerSample;
  var byteRate = sampleRate * blockAlign;
  var dataSize = samples * blockAlign;
  var buffer = new ArrayBuffer(44 + dataSize);
  var view = new DataView(buffer);

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt subchunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // subchunk1Size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample

  // data subchunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // write interleaved PCM samples (16-bit little endian)
  var offset = 44;
  for(var i=0;i<samples;i++){
    for(var ch=0; ch<numChannels; ch++){
      var sample = audioBuffer.getChannelData(ch)[i];
      // clamp
      var s = Math.max(-1, Math.min(1, sample));
      var intSample = s < 0 ? s * 0x8000 : s * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return buffer;
}

function previewEncodeAudio(){
  var file = document.querySelector('#audio-app input[name=baseFile]').files[0];
  var $images = $('#audio-app .images');
  $images.hide();
  $('#audio-app .download').prop('disabled', true);
  if(!file) return;
  ensureWavArrayBuffer(file).then(wavBuf=>{
    try{
      var info = parseWav(wavBuf);
      $('#audio-app .original .meta').text('Name: ' + file.name + '\n' + info.numChannels + ' channel(s) | ' + info.sampleRate + ' Hz | ' + info.bitsPerSample + ' bits | Data bytes: ' + info.dataSize);
      $images.show();
    }catch(e){
      $('#audio-app .error').text('Error: ' + e.message).show();
    }
  }).catch(err=>$('#audio-app .error').text('Error reading/decoding file: '+err).show());
}

function previewDecodeAudio(){
  var file = document.querySelector('#audio-app input[name=decodeFile]').files[0];
  if(!file) return;
  ensureWavArrayBuffer(file).then(wavBuf=>{
    try{
      var info = parseWav(wavBuf);
      $('#audio-app .decode .meta').text('Name: ' + file.name + '\n' + info.numChannels + ' channel(s) | ' + info.sampleRate + ' Hz | ' + info.bitsPerSample + ' bits | Data bytes: ' + info.dataSize);
      $('#audio-app .decode').show();
    }catch(e){
      $('#audio-app .error').text('Error: ' + e.message).show();
    }
  }).catch(err=>$('#audio-app .error').text('Error reading/decoding file: '+err).show());
}

function encodeMessageAudio(e){
  if(e) e.preventDefault();
  $('#audio-app .error').hide();
  $('#audio-app .binary').hide();

  var text = $('#audio-app textarea.message').val() || '';
  var file = document.querySelector('#audio-app input[name=baseFile]').files[0];
  if(!file){$('#audio-app .error').text('Please select an audio file to encode into.').show();return;}

  ensureWavArrayBuffer(file).then(buf=>{
    try{
      var info = parseWav(buf);

      var bytesPerSample = info.bitsPerSample / 8;
      var sampleCount = info.dataSize / bytesPerSample; // total samples across channels
      // Capacity: one bit per sample (we write into the least-significant byte of each sample)
      var capacityBits = sampleCount;
      var neededBits = text.length * 8;

      if(neededBits > capacityBits){
        $('#audio-app .error').text('Text too long for chosen audio file.... (needs ' + neededBits + ' bits, capacity ' + capacityBits + ' bits)').show();
        return;
      }

      // Build binary string
      // Prepend a 4-byte big-endian length header so decoding knows exact message length
      var binaryMessage = '';
      var msgLen = text.length >>> 0; // number of bytes
      // 4-byte big-endian length
      var headerBytes = [ (msgLen >>> 24) & 0xFF, (msgLen >>> 16) & 0xFF, (msgLen >>> 8) & 0xFF, msgLen & 0xFF ];
      headerBytes.forEach(function(byte){
        var bb = byte.toString(2);
        while(bb.length < 8) bb = '0' + bb;
        binaryMessage += bb;
      });

      for(var i=0;i<text.length;i++){
        var b = text.charCodeAt(i).toString(2);
        while(b.length < 8) b = '0' + b;
        binaryMessage += b;
      }
      $('#audio-app .binary textarea').text(binaryMessage);

      // Copy ArrayBuffer to modify
  var out = new Uint8Array(buf.byteLength);
  out.set(new Uint8Array(buf));

      // Modify LSB of each sample's least significant byte
      var dataOffset = info.dataOffset;
      var bytesPerSampleInt = bytesPerSample;
      var bitIdx = 0;
      for(var s=0; s<sampleCount && bitIdx < binaryMessage.length; s++){
        var byteIndex = dataOffset + (s * bytesPerSampleInt); // little-endian: LSB is first byte
        var bit = parseInt(binaryMessage[bitIdx]);
        out[byteIndex] = (out[byteIndex] & 0xFE) | bit; // set LSB
        bitIdx++;
      }

      // Create blob
      var blob = new Blob([out.buffer], {type: 'audio/wav'});
      var url = URL.createObjectURL(blob);
      $('#audio-app .message pre').text('Encoded file size: ' + blob.size + ' bytes');
      $('#audio-app .message').show();
      $('#audio-app .binary').show();
      $('#audio-app .images').show();
      $('#audio-app .download').prop('disabled', false).data('bloburl', url).data('blob', blob);

    }catch(err){
      $('#audio-app .error').text('Error: ' + err.message).show();
    }
  }).catch(err=>$('#audio-app .error').text('Error reading file: '+err).show());
}

function downloadMessageAudio(e){
  if(e) e.preventDefault();
  var $btn = $('#audio-app .download');
  var url = $btn.data('bloburl');
  var blob = $btn.data('blob');
  if(!blob) { alert('No encoded audio available to download.'); return; }

  if(window.navigator && window.navigator.msSaveOrOpenBlob){
    window.navigator.msSaveOrOpenBlob(blob, 'stego.wav');
    return;
  }
  var a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = 'stego.wav';
  document.body.appendChild(a);
  a.click();
  setTimeout(function(){ document.body.removeChild(a); }, 100);
}

function decodeMessageAudio(e){
  if(e) e.preventDefault();
  $('#audio-app .error').hide();
  var file = document.querySelector('#audio-app input[name=decodeFile]').files[0];
  if(!file){$('#audio-app .error').text('Please select an audio file to decode.').show();return;}

  ensureWavArrayBuffer(file).then(function(wavBuf){
    try{
      var info = parseWav(wavBuf);
      if(info.audioFormat !== 1 || info.bitsPerSample !== 16){
        throw new Error('Only 16-bit PCM WAV files are supported');
      }
      var bytesPerSample = info.bitsPerSample / 8;
      var sampleCount = info.dataSize / bytesPerSample;
      var dv = new DataView(wavBuf);

      var bits = '';
      for(var s=0;s<sampleCount;s++){
        var byteIndex = info.dataOffset + (s * bytesPerSample);
        var lsb = dv.getUint8(byteIndex) & 1;
        bits += (lsb ? '1' : '0');
      }

      // Try to read 32-bit big-endian length header first
      var output = '';
      if(bits.length >= 32){
        var headerBits = bits.substr(0,32);
        var hb = [];
        for(var k=0;k<4;k++){
          hb.push(parseInt(headerBits.substr(k*8,8),2) & 0xFF);
        }
        var declaredLen = ((hb[0]<<24) | (hb[1]<<16) | (hb[2]<<8) | hb[3]) >>> 0;
        var maxPayloadBytes = Math.floor((bits.length - 32)/8);
        if(declaredLen <= maxPayloadBytes){
          // good header -> extract exactly declaredLen bytes
          var payloadBits = bits.substr(32, declaredLen * 8);
          for(var i=0;i<payloadBits.length;i+=8){
            var byte = payloadBits.substr(i,8);
            var c = parseInt(byte,2);
            output += String.fromCharCode(c);
          }
          $('#audio-app .binary-decode textarea').text(output);
          $('#audio-app .binary-decode').show();
          return;
        }
      }

      // Fallback for legacy files (no header): decode whole stream and trim trailing NULs
      for(var i=0;i<bits.length;i+=8){
        var byte = bits.substr(i,8);
        if(byte.length < 8) break;
        var c = parseInt(byte,2);
        output += String.fromCharCode(c);
      }
      // Trim trailing null characters that are likely padding
      output = output.replace(/\x00+$/g, '');
      $('#audio-app .binary-decode textarea').text(output);
      $('#audio-app .binary-decode').show();
    }catch(err){
      $('#audio-app .error').text('Error: ' + err.message).show();
    }
  }).catch(err=>$('#audio-app .error').text('Error reading file: '+err).show());
}

// Prevent default form submissions globally inside page
$('#audio-app form').on('submit', function(e){ e.preventDefault(); });
