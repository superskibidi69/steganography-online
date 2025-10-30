// Audio LSB script — supports 16-bit PCM WAV files
$('button.encode, button.decode, button.download').click(function(e){e.preventDefault();});

// Worker management
var audioWorker = null;
function ensureAudioWorker(){
  if (audioWorker) return;
  if (window.Worker) {
    try { audioWorker = new Worker('/audio/worker.js'); } catch(e) { audioWorker = null; }
  }
}

function resetAudioWorker(){
  if (audioWorker) {
    try { audioWorker.terminate(); } catch(e) {}
    audioWorker = null;
  }
  $('#audio-app .progress-area').hide();
  $('#audio-app .progress-area .progress-bar').css('width','0%').text('0%');
  $('#audio-app .progress-area .cancel-process').hide();
}

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
          // Preferred path: use audio worker to perform bit writes off-main-thread
          ensureAudioWorker();
          var msgLen = text.length >>> 0;
          var messageBytes = new Uint8Array(4 + text.length);
          messageBytes[0] = (msgLen >>> 24) & 0xFF;
          messageBytes[1] = (msgLen >>> 16) & 0xFF;
          messageBytes[2] = (msgLen >>> 8) & 0xFF;
          messageBytes[3] = msgLen & 0xFF;
          for (var z = 0; z < text.length; z++) messageBytes[4 + z] = text.charCodeAt(z) & 0xFF;

          if (audioWorker) {
            $('#audio-app .progress-area').show();
            $('#audio-app .progress-area .cancel-process').show();
            $('#audio-app .progress-area .progress-bar').css('width','0%').text('0%');

            var onmessage = function(ev) {
              var d = ev.data;
              if (d.type === 'progress') {
                $('#audio-app .progress-area .progress-bar').css('width', d.progress + '%').text(d.progress + '%');
              } else if (d.type === 'done') {
                var outBuf = d.buffer;
                var blob = new Blob([outBuf], {type: 'audio/wav'});
                var url = URL.createObjectURL(blob);
                $('#audio-app .message pre').text('Encoded file size: ' + blob.size + ' bytes');
                $('#audio-app .message').show();
                $('#audio-app .binary').show();
                $('#audio-app .images').show();
                $('#audio-app .download').prop('disabled', false).data('bloburl', url).data('blob', blob);
                audioWorker.removeEventListener('message', onmessage);
                resetAudioWorker();
              } else if (d.type === 'error') {
                $('#audio-app .error').text('Worker error: ' + d.message).show();
                audioWorker.removeEventListener('message', onmessage);
                resetAudioWorker();
              }
            };
            audioWorker.addEventListener('message', onmessage);
            try {
              audioWorker.postMessage({action: 'encode', buffer: buf, info: {dataOffset: info.dataOffset, bytesPerSample: bytesPerSample, sampleCount: sampleCount}, messageBytes: messageBytes}, [buf, messageBytes.buffer]);
            } catch (err) {
              // fallback: copy buffers
              audioWorker.postMessage({action: 'encode', buffer: (new Uint8Array(buf)).buffer, info: {dataOffset: info.dataOffset, bytesPerSample: bytesPerSample, sampleCount: sampleCount}, messageBytes: messageBytes}, [(new Uint8Array(buf)).buffer, messageBytes.buffer]);
            }
            $('#audio-app .progress-area .cancel-process').off('click').on('click', function(){ resetAudioWorker(); });
          } else {
            // Fallback to main-thread write
            var out = new Uint8Array(buf);
            var dataOffset = info.dataOffset;
            var bytesPerSampleInt = bytesPerSample;
            var bitIdx = 0;
            function writeBit(bit) { var s = bitIdx; var byteIndex = dataOffset + (s * bytesPerSampleInt); out[byteIndex] = (out[byteIndex] & 0xFE) | (bit & 1); bitIdx++; }
            for (var hi = 0; hi < messageBytes.length; hi++) {
              var hb = messageBytes[hi];
              for (var b = 7; b >= 0; b--) writeBit((hb >> b) & 1);
            }
            var blob = new Blob([out.buffer], {type: 'audio/wav'});
            var url = URL.createObjectURL(blob);
            $('#audio-app .message pre').text('Encoded file size: ' + blob.size + ' bytes');
            $('#audio-app .message').show();
            $('#audio-app .binary').show();
            $('#audio-app .images').show();
            $('#audio-app .download').prop('disabled', false).data('bloburl', url).data('blob', blob);
          }

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
      // Try using worker for decoding to avoid blocking
      ensureAudioWorker();
      if (audioWorker) {
        $('#audio-app .progress-area').show();
        $('#audio-app .progress-area .cancel-process').show();
        $('#audio-app .progress-area .progress-bar').css('width','0%').text('0%');

        var onmessage = function(ev) {
          var d = ev.data;
          if (d.type === 'progress') {
            $('#audio-app .progress-area .progress-bar').css('width', d.progress + '%').text(d.progress + '%');
          } else if (d.type === 'done-decode') {
            $('#audio-app .binary-decode textarea').text(d.text);
            $('#audio-app .binary-decode').show();
            audioWorker.removeEventListener('message', onmessage);
            resetAudioWorker();
          } else if (d.type === 'error') {
            $('#audio-app .error').text('Worker error: ' + d.message).show();
            audioWorker.removeEventListener('message', onmessage);
            resetAudioWorker();
          }
        };

        audioWorker.addEventListener('message', onmessage);
        try {
          audioWorker.postMessage({action: 'decode', buffer: wavBuf, info: {dataOffset: info.dataOffset, bytesPerSample: bytesPerSample, sampleCount: sampleCount}}, [wavBuf]);
        } catch (err) {
          audioWorker.postMessage({action: 'decode', buffer: (new Uint8Array(wavBuf)).buffer, info: {dataOffset: info.dataOffset, bytesPerSample: bytesPerSample, sampleCount: sampleCount}}, [(new Uint8Array(wavBuf)).buffer]);
        }
        $('#audio-app .progress-area .cancel-process').off('click').on('click', function(){ resetAudioWorker(); });
        return;
      }

      // Fallback: read LSBs directly without building a giant bits string.
      var bytesPerSampleInt = info.bitsPerSample / 8;
      var dv = new DataView(wavBuf);

      function readBitAt(sampleIndex) {
        var byteIndex = info.dataOffset + (sampleIndex * bytesPerSampleInt);
        return dv.getUint8(byteIndex) & 1;
      }

      // Read 32-bit big-endian length header first (if available)
      if (sampleCount >= 32) {
        var headerVal = 0 >>> 0;
        for (var hbi = 0; hbi < 32; hbi++) {
          headerVal = ((headerVal << 1) | readBitAt(hbi)) >>> 0;
        }
        var declaredLen = headerVal >>> 0;
        var maxPayloadBytes = Math.floor((sampleCount - 32) / 8);
        if (declaredLen <= maxPayloadBytes) {
          // extract payload exactly declaredLen bytes
          var outChars = [];
          var startBit = 32;
          for (var byteIdx = 0; byteIdx < declaredLen; byteIdx++) {
            var c = 0;
            for (var bitPos = 0; bitPos < 8; bitPos++) {
              c = (c << 1) | readBitAt(startBit + byteIdx * 8 + bitPos);
            }
            outChars.push(String.fromCharCode(c));
          }
          var output = outChars.join('');
          $('#audio-app .binary-decode textarea').text(output);
          $('#audio-app .binary-decode').show();
          return;
        }
      }

      // Fallback: decode as much as possible and trim trailing NULs
      var outChars2 = [];
      var totalBytes = Math.floor(sampleCount / 8);
      for (var bi = 0; bi < totalBytes; bi++) {
        var c2 = 0;
        for (var bitj = 0; bitj < 8; bitj++) {
          c2 = (c2 << 1) | readBitAt(bi * 8 + bitj);
        }
        outChars2.push(String.fromCharCode(c2));
      }
      var output2 = outChars2.join('');
      output2 = output2.replace(/\x00+$/g, '');
      $('#audio-app .binary-decode textarea').text(output2);
      $('#audio-app .binary-decode').show();
    }catch(err){
      $('#audio-app .error').text('Error: ' + err.message).show();
    }
  }).catch(err=>$('#audio-app .error').text('Error reading file: '+err).show());
}

// Prevent default form submissions globally inside page
$('#audio-app form').on('submit', function(e){ e.preventDefault(); });
