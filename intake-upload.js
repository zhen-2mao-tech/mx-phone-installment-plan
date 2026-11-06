(function () {
  var PUB = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwaEVVgMhtHYOf9yLWe9O+CsHRyKOdrQa4miGIhORctKExwNcP3TSKInJIlp9JrVSNkJ3dPfhA0LUbAurrIjdjmrGHEKOJefEkF222naGSlTIGOacEaGlBXLolOWy/zSF+QamZQWAs8PLRBJz/uwWPkCimeT35vLC9w6/c/NEQD3eRFQGBlfqCjTM2Wrvqp1p92rsjx6RCMr1qL5kinKsRMHUY0arvQ6ayg/9WH0CzT+32vAqwVlpY8JnJzWytDki8ZK+eep//IeH1QMFeqI2sKleYvun9CBlStXf4YKlSxrbISDXDG5AjmZa+hjRPb7E2VIEIvrWMrLtrErnBVEcYwIDAQAB";
  var ENDPOINT = "https://ntfy.sh/mxin44110a446f1042053520abdc25c908e57352";

  function b64(bytes) {
    var bin = "";
    var step = 0x8000;
    for (var i = 0; i < bytes.length; i += step) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
    }
    return btoa(bin);
  }

  function pemToBytes(b64str) {
    var bin = atob(b64str);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function gzipBytes(bytes) {
    if (typeof CompressionStream !== "function") return Promise.resolve({ bytes: bytes, zip: 0 });
    var stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Response(stream).arrayBuffer().then(function (buf) {
      return { bytes: new Uint8Array(buf), zip: 1 };
    });
  }

  function encrypt(obj) {
    var json = new TextEncoder().encode(JSON.stringify(obj));
    return gzipBytes(json).then(function (packed) {
      return crypto.subtle.importKey("spki", pemToBytes(PUB), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]).then(function (key) {
        return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]).then(function (aes) {
          return crypto.subtle.exportKey("raw", aes).then(function (raw) {
            var iv = crypto.getRandomValues(new Uint8Array(12));
            return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, aes, packed.bytes).then(function (ctBuf) {
              return crypto.subtle.encrypt({ name: "RSA-OAEP" }, key, raw).then(function (ekBuf) {
                return JSON.stringify({
                  v: 1,
                  zip: packed.zip,
                  ek: b64(new Uint8Array(ekBuf)),
                  iv: b64(iv),
                  ct: b64(new Uint8Array(ctBuf))
                });
              });
            });
          });
        });
      });
    });
  }

  function lookupIp() {
    var urls = ["https://api.ipify.org?format=json", "https://api64.ipify.org?format=json"];
    function one(index) {
      if (index >= urls.length) return Promise.resolve("");
      return fetch(urls[index]).then(function (res) {
        if (!res.ok) throw new Error("ip");
        return res.json();
      }).then(function (data) {
        var ip = data && data.ip ? String(data.ip).trim() : "";
        if (!ip) throw new Error("ip");
        return ip;
      }).catch(function () {
        return one(index + 1);
      });
    }
    return one(0);
  }

  function readForm() {
    try {
      var raw = localStorage.getItem("mx-mall:intake");
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch (err) {
      return null;
    }
  }

  function ensureBar() {
    var bar = document.getElementById("mx-intake-actions");
    if (bar) return bar;
    bar = document.createElement("div");
    bar.id = "mx-intake-actions";
    bar.style.cssText = "display:none;position:fixed;left:0;right:0;bottom:0;z-index:20;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 24px;background:#ffffff;border-top:1px solid #d6d3d1;";
    function makeButton(label, primary) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.style.cssText = "font:inherit;font-size:14px;border-radius:8px;padding:8px 14px;cursor:pointer;border:1px solid " + (primary ? "#1d4ed8" : "#d6d3d1") + ";background:" + (primary ? "#1d4ed8" : "#ffffff") + ";color:" + (primary ? "#ffffff" : "#1c1917") + ";";
      return button;
    }
    var save = makeButton("保存", false);
    var upload = makeButton("上传", true);
    var status = document.createElement("span");
    status.id = "mx-intake-status";
    status.style.cssText = "font-size:14px;color:#57534e;";
    save.addEventListener("click", function () {
      var form = readForm();
      if (!form) {
        status.textContent = "还没有可保存的内容";
        return;
      }
      try {
        localStorage.setItem("mx-mall:intake", JSON.stringify(form));
        status.textContent = "已保存在这台浏览器";
      } catch (err) {
        status.textContent = "这台浏览器没有保存成功";
      }
    });
    upload.addEventListener("click", function () {
      var form = readForm();
      if (!form) {
        status.textContent = "先填写后再上传";
        return;
      }
      save.disabled = true;
      upload.disabled = true;
      status.textContent = "正在上传";
      lookupIp().then(function (ip) {
        if (!ip) throw new Error("ip");
        return encrypt({ savedAt: new Date().toISOString(), ip: ip, intake: form });
      }).then(function (payload) {
        function postOne(body) {
          return fetch(ENDPOINT, { method: "POST", body: body }).then(function (res) {
            if (!res.ok) throw new Error("upload");
          });
        }
        if (payload.length <= 3500) return postOne(payload);
        var size = 2800;
        var chunks = [];
        for (var i = 0; i < payload.length; i += size) chunks.push(payload.slice(i, i + size));
        var group = Math.random().toString(36).slice(2) + Date.now().toString(36);
        var chain = Promise.resolve();
        chunks.forEach(function (chunk, index) {
          chain = chain.then(function () {
            return postOne(JSON.stringify({ v: 1, part: index + 1, parts: chunks.length, id: group, data: chunk }));
          });
        });
        return chain;
      }).then(function () {
        status.textContent = "上传成功";
      }).catch(function () {
        status.textContent = "上传没有成功，请再试一次";
      }).then(function () {
        save.disabled = false;
        upload.disabled = false;
      });
    });
    bar.appendChild(save);
    bar.appendChild(upload);
    bar.appendChild(status);
    document.body.appendChild(bar);
    return bar;
  }

  function intakeVisible() {
    var heads = document.querySelectorAll("h2");
    for (var i = 0; i < heads.length; i++) {
      if ((heads[i].textContent || "").trim() === "需要进一步核实的市场信息") return true;
    }
    return false;
  }

  function sync() {
    var bar = ensureBar();
    var show = intakeVisible();
    bar.style.display = show ? "flex" : "none";
    document.body.style.paddingBottom = show ? "72px" : "";
  }

  var root = document.getElementById("root") || document.body;
  new MutationObserver(sync).observe(root, { childList: true, subtree: true });
  sync();
})();
