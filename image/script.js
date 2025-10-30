$('button.encode, button.decode, button.download').click(function(event) {
  event.preventDefault();
});

// Worker and cancellation handle
var imageWorker = null;
var imageWorkerActive = false;

function ensureImageWorker() {
  if (imageWorker) return;
  if (window.Worker) {
    try {
      imageWorker = new Worker('/image/worker.js');
    } catch (err) {
      imageWorker = null;
    }
  }
}

function resetImageWorker() {
  if (imageWorker) {
    try { imageWorker.terminate(); } catch (e) {}
    imageWorker = null;
  }
  imageWorkerActive = false;
  $('.progress-area').hide();
  $('.progress-area .progress-bar').css('width','0%').text('0%');
  $('.progress-area .cancel-process').hide();
}

function previewDecodeImage() {
  var file = document.querySelector('input[name=decodeFile]').files[0];

  previewImage(file, ".decode canvas", function() {
    $(".decode").fadeIn();
  });
}

function previewEncodeImage() {
  var file = document.querySelector("input[name=baseFile]").files[0];

  $(".images .nulled").hide();
  $(".images .message").hide();
  // Disable download until a new encoded image is created
  $(".download").prop('disabled', true);

  previewImage(file, ".original canvas", function() {
    $(".images .original").fadeIn();
    $(".images").fadeIn();
  });
}

function previewImage(file, canvasSelector, callback) {
  var reader = new FileReader();
  var image = new Image;
  var $canvas = $(canvasSelector);
  var context = $canvas[0].getContext('2d');

  // validate file is an image
  if (!file) return;
  if (file.type && !file.type.startsWith('image/')) {
    $(".error").text('Please select an image file (PNG / JPG / GIF etc).').fadeIn();
    return;
  }
  $(".error").hide();

  if (file) {
    reader.readAsDataURL(file);
  }

  reader.onloadend = function () {
    image.src = URL.createObjectURL(file);

    image.onload = function() {
      $canvas.prop({
        'width': image.width,
        'height': image.height
      });

      context.drawImage(image, 0, 0);

      callback();
    }
  }
}

function encodeMessage(event) {
  if (event && event.preventDefault) event.preventDefault();
  $(".error").hide();
  $(".binary").hide();

  var text = $("textarea.message").val();

  var $originalCanvas = $('.original canvas');
  var $nulledCanvas = $('.nulled canvas');
  var $messageCanvas = $('.message canvas');

  var originalContext = $originalCanvas[0].getContext("2d");
  var nulledContext = $nulledCanvas[0].getContext("2d");
  var messageContext = $messageCanvas[0].getContext("2d");

  var width = $originalCanvas[0].width;
  var height = $originalCanvas[0].height;

  // Check if the image is big enough to hide the message
  if ((text.length * 8) > (width * height * 3)) {
    $(".error")
      .text("Text too long for chosen image....")
      .fadeIn();

    return;
  }

  $nulledCanvas.prop({
    'width': width,
    'height': height
  });

  $messageCanvas.prop({
    'width': width,
    'height': height
  });
  // If Web Worker available, hand off the heavy work to it
  ensureImageWorker();
  if (imageWorker) {
    imageWorkerActive = true;
    $('.progress-area').show();
    $('.progress-area .cancel-process').show();
    $('.progress-area .progress-bar').css('width','0%').text('0%');

    var messageBytes = new Uint8Array(text.length + 4);
    // 4-byte big endian length header
    var msgLen = text.length >>> 0;
    messageBytes[0] = (msgLen >>> 24) & 0xFF;
    messageBytes[1] = (msgLen >>> 16) & 0xFF;
    messageBytes[2] = (msgLen >>> 8) & 0xFF;
    messageBytes[3] = msgLen & 0xFF;
    for (var mi = 0; mi < text.length; mi++) messageBytes[4 + mi] = text.charCodeAt(mi) & 0xFF;

    var imageData = originalContext.getImageData(0, 0, width, height);
    var pixels = imageData.data;

    var onmessage = function(ev) {
      var d = ev.data;
      if (d.type === 'progress') {
        $('.progress-area .progress-bar').css('width', d.progress + '%').text(d.progress + '%');
      } else if (d.type === 'done') {
        // d.imageData is transferred ArrayBuffer
        var newPixels = new Uint8ClampedArray(d.imageData);
        var newImageData = new ImageData(newPixels, width, height);
        messageContext.putImageData(newImageData, 0, 0);
        $('.binary').fadeIn();
        $('.images .nulled').fadeIn();
        $('.images .message').fadeIn();
        $('.download').prop('disabled', false);
        imageWorker.removeEventListener('message', onmessage);
        resetImageWorker();
      } else if (d.type === 'error') {
        $('.error').text('Worker error: ' + d.message).show();
        imageWorker.removeEventListener('message', onmessage);
        resetImageWorker();
      }
    };

    imageWorker.addEventListener('message', onmessage);
    // Transfer the pixel buffer to worker
    try {
      imageWorker.postMessage({action: 'encode', width: width, height: height, imageData: pixels.buffer, messageBytes: messageBytes}, [pixels.buffer, messageBytes.buffer]);
    } catch (err) {
      // if transfer fails, fall back to copying
      imageWorker.postMessage({action: 'encode', width: width, height: height, imageData: (new Uint8ClampedArray(pixels)).buffer, messageBytes: messageBytes}, [(new Uint8ClampedArray(pixels)).buffer, messageBytes.buffer]);
    }
    // cancel button handler
    $('.progress-area .cancel-process').off('click').on('click', function() {
      resetImageWorker();
    });
    return;
  }

  // Fallback if no worker: do chunked processing on main thread (existing behavior)
  var original = originalContext.getImageData(0, 0, width, height);
  var pixel = original.data;
  // Normalize in chunks
  (function normalizePixelsAsync(){
    var i = 0;
    var n = pixel.length;
    var CHUNK = 1 << 20;
    function step() {
      var end = Math.min(i + CHUNK, n);
      for (; i < end; i += 4) {
        for (var offset = 0; offset < 3; offset++) if (pixel[i + offset] % 2 != 0) pixel[i + offset]--;
      }
      if (i < n) setTimeout(step, 0);
      else {
        nulledContext.putImageData(original, 0, 0);
        applyMessageAsync();
      }
    }
    step();
  })();

  function applyMessageAsync(){
    var msgBytes = new Uint8Array(text.length);
    for (var i = 0; i < text.length; i++) msgBytes[i] = text.charCodeAt(i) & 0xFF;
    $('.binary textarea').text('(' + msgBytes.length + ' bytes)');
    var message = nulledContext.getImageData(0, 0, width, height);
    pixel = message.data;
    var totalBits = msgBytes.length * 8;
    var bitIndex = 0;
    var i = 0;
    var n = pixel.length;
    var CHUNK_PIXELS = 1 << 16;
    function step() {
      var processed = 0;
      while (i < n && bitIndex < totalBits && processed < CHUNK_PIXELS) {
        for (var offset = 0; offset < 3 && bitIndex < totalBits; offset++) {
          var byteIndex = (bitIndex / 8) | 0;
          var bitInByte = 7 - (bitIndex & 7);
          var bit = (msgBytes[byteIndex] >> bitInByte) & 1;
          pixel[i + offset] = (pixel[i + offset] & 0xFE) | bit;
          bitIndex++;
        }
        i += 4;
        processed++;
      }
      if (i < n && bitIndex < totalBits) setTimeout(step, 0);
      else {
        messageContext.putImageData(message, 0, 0);
        $('.binary').fadeIn();
        $('.images .nulled').fadeIn();
        $('.images .message').fadeIn();
        $('.download').prop('disabled', false);
      }
    }
    step();
  }
};

// Download the message canvas as an image (PNG)
function downloadMessageImage(event) {
  if (event && event.preventDefault) event.preventDefault();
  var canvas = document.querySelector('.message canvas');

  if (!canvas) {
    alert('No encoded message canvas available to download.');
    return;
  }

  // Prefer toBlob when available for binary download and better memory usage
  if (canvas.toBlob) {
    canvas.toBlob(function(blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = 'stego.png';
      document.body.appendChild(a);
      a.click();
      // cleanup
      setTimeout(function() {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 167);
    }, 'image/png');
  }
  else {
    // Fallback for older browsers
    var dataURL = canvas.toDataURL('image/png');
    var a = document.createElement('a');
    a.style.display = 'none';
    a.href = dataURL;
    a.download = 'stego.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
}

function decodeMessage(event) {
  if (event && event.preventDefault) event.preventDefault();
  var $originalCanvas = $('.decode canvas');
  var originalContext = $originalCanvas[0].getContext("2d");
  // Try to use a worker for decoding if available
  ensureImageWorker();
  var imageData = originalContext.getImageData(0, 0, $originalCanvas[0].width, $originalCanvas[0].height);
  var pixels = imageData.data;
  if (imageWorker) {
    imageWorkerActive = true;
    $('.progress-area').show();
    $('.progress-area .cancel-process').show();
    $('.progress-area .progress-bar').css('width','0%').text('0%');

    var onmessage = function(ev) {
      var d = ev.data;
      if (d.type === 'progress') {
        $('.progress-area .progress-bar').css('width', d.progress + '%').text(d.progress + '%');
      } else if (d.type === 'done-decode') {
        $('.binary-decode textarea').text(d.text);
        $('.binary-decode').fadeIn();
        imageWorker.removeEventListener('message', onmessage);
        resetImageWorker();
      } else if (d.type === 'error') {
        $('.error').text('Worker error: ' + d.message).show();
        imageWorker.removeEventListener('message', onmessage);
        resetImageWorker();
      }
    };

    imageWorker.addEventListener('message', onmessage);
    try {
      imageWorker.postMessage({action: 'decode', imageData: pixels.buffer}, [pixels.buffer]);
    } catch (err) {
      imageWorker.postMessage({action: 'decode', imageData: (new Uint8ClampedArray(pixels)).buffer}, [(new Uint8ClampedArray(pixels)).buffer]);
    }
    $('.progress-area .cancel-process').off('click').on('click', function() { resetImageWorker(); });
    return;
  }

  // Fallback: do main-thread chunked decode
  var pixel = pixels;
  (function decodeAsync(){
    var i = 0;
    var n = pixel.length;
    var CHUNK_PIXELS = 1 << 16;
    var bitsBuffer = [];

    function step() {
      var processed = 0;
      while (i < n && processed < CHUNK_PIXELS) {
        for (var offset = 0; offset < 3; offset++) bitsBuffer.push(pixel[i + offset] & 1);
        i += 4; processed++;
      }
      if (i < n) setTimeout(step, 0);
      else {
        var out = [];
        for (var bi = 0; bi + 7 < bitsBuffer.length; bi += 8) {
          var c = 0;
          for (var j = 0; j < 8; j++) c = (c << 1) | bitsBuffer[bi + j];
          out.push(String.fromCharCode(c));
        }
        var output = out.join('');
        $('.binary-decode textarea').text(output);
        $('.binary-decode').fadeIn();
      }
    }
    step();
  })();
};
