(function () {
  var PUB = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwaEVVgMhtHYOf9yLWe9O+CsHRyKOdrQa4miGIhORctKExwNcP3TSKInJIlp9JrVSNkJ3dPfhA0LUbAurrIjdjmrGHEKOJefEkF222naGSlTIGOacEaGlBXLolOWy/zSF+QamZQWAs8PLRBJz/uwWPkCimeT35vLC9w6/c/NEQD3eRFQGBlfqCjTM2Wrvqp1p92rsjx6RCMr1qL5kinKsRMHUY0arvQ6ayg/9WH0CzT+32vAqwVlpY8JnJzWytDki8ZK+eep//IeH1QMFeqI2sKleYvun9CBlStXf4YKlSxrbISDXDG5AjmZa+hjRPb7E2VIEIvrWMrLtrErnBVEcYwIDAQAB";
  var ENDPOINT = "https://ntfy.sh/mxin44110a446f1042053520abdc25c908e57352";
  var STORE_KINDS = [
    ["direct", "直营店"],
    ["specialty", "专营店"],
    ["agent", "代理经销店"],
    ["dealer", "经销门店"],
    ["comprehensive", "综合经销店"]
  ];

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

  function postPayload(payload) {
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

  function textOf(value) {
    return value == null ? "" : String(value);
  }

  function formRows(form) {
    var rows = [];
    function add(group, item, value) {
      rows.push([group, item, textOf(value)]);
    }
    add("核实记录", "核实人", form.oemWriter);
    add("核实记录", "渠道侧核对人", form.dealerWriter);
    add("核实记录", "核实日期", form.asOf);
    add("品牌和市场", "在当地卖的品牌和系列", form.brand);
    add("品牌和市场", "市场占有率", form.share);
    add("品牌和市场", "线上销量和线下销量", form.onlineOffline);
    (form.skus || []).forEach(function (row, index) {
      var name = "SKU" + (index + 1);
      add("品类", name + " 机型", row && row.name);
      add("品类", name + " 单价", row && row.price);
      add("品类", name + " 出货量", row && row.shipments);
      add("品类", name + " 保有量", row && row.installed);
      add("品类", name + " 增速", row && row.growth);
    });
    add("分期", "线上分期渗透率", form.penetrationOnline);
    add("分期", "线下分期渗透率", form.penetrationOffline);
    add("分期", "线上已经在用的分期", form.onlineInstallment);
    add("分期", "已经引进的线下分期供应商", form.offlineSuppliers);
    add("分期", "门店已经铺开的分期品种，以及对应的分期支付服务商", form.productsInStore);
    var stores = form.stores || {};
    STORE_KINDS.forEach(function (kind) {
      var row = stores[kind[0]] || {};
      add("门店", kind[1] + " 家数", row.count);
      add("门店", kind[1] + " 库存归谁", row.inventory);
      add("门店", kind[1] + " 促销员谁派", row.promoter);
    });
    add("门店", "其他叫法", form.storeNote);
    add("促销员", "厂商自雇的促销员", form.promoterOem);
    add("促销员", "经销商自己的促销员", form.promoterDealer);
    add("客户", "当地主要客户画像", form.customer);
    (form.targets || []).forEach(function (row) {
      var period = textOf(row && row.period) || "未填期间";
      add("经营目标", period + " 经营目标", row && row.total);
      add("经营目标", period + " 其中分期承担", row && row.installment);
    });
    add("法律和监管", "分期要依赖的当地法律", form.law);
    add("法律和监管", "市场监督管理的要求", form.regulator);
    add("其他建议和意见", "建议和意见", form.suggestions);
    return rows;
  }

  function xmlEscape(value) {
    return textOf(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function columnName(index) {
    var name = "";
    var n = index;
    while (n > 0) {
      var rem = (n - 1) % 26;
      name = String.fromCharCode(65 + rem) + name;
      n = Math.floor((n - 1) / 26);
    }
    return name;
  }

  function sheetXml(rows, widths) {
    var cols = (widths || []).map(function (width, index) {
      var n = index + 1;
      return '<col min="' + n + '" max="' + n + '" width="' + width + '" customWidth="1"/>';
    }).join("");
    var body = rows.map(function (row, r) {
      var cells = row.map(function (value, c) {
        var ref = columnName(c + 1) + (r + 1);
        return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEscape(value) + "</t></is></c>";
      }).join("");
      return '<row r="' + (r + 1) + '">' + cells + "</row>";
    }).join("");
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      (cols ? "<cols>" + cols + "</cols>" : "") +
      "<sheetData>" + body + "</sheetData></worksheet>";
  }

  function crc32(bytes) {
    if (!crc32.table) {
      var table = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
      }
      crc32.table = table;
    }
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) crc = crc32.table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function concat(parts) {
    var size = 0;
    parts.forEach(function (part) { size += part.length; });
    var out = new Uint8Array(size);
    var offset = 0;
    parts.forEach(function (part) {
      out.set(part, offset);
      offset += part.length;
    });
    return out;
  }

  function bytesOf(numbers) {
    return new Uint8Array(numbers);
  }

  function u16(n) {
    return bytesOf([n & 255, (n >> 8) & 255]);
  }

  function u32(n) {
    return bytesOf([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]);
  }

  function zipStore(files) {
    var encoder = new TextEncoder();
    var locals = [];
    var centrals = [];
    var offset = 0;
    files.forEach(function (file) {
      var name = encoder.encode(file.name);
      var data = encoder.encode(file.text);
      var crc = crc32(data);
      var local = concat([
        u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0),
        name, data
      ]);
      var central = concat([
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length),
        u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset),
        name
      ]);
      locals.push(local);
      centrals.push(central);
      offset += local.length;
    });
    var central = concat(centrals);
    var end = concat([
      u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
      u32(central.length), u32(offset), u16(0)
    ]);
    return concat(locals.concat([central, end]));
  }

  function workbook(rows) {
    var vertical = [["分组", "项目", "内容"]].concat(rows);
    var wide = [rows.map(function (row) { return row[0] + " / " + row[1]; }), rows.map(function (row) { return row[2]; })];
    var files = [
      {
        name: "[Content_Types].xml",
        text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          "</Types>"
      },
      {
        name: "_rels/.rels",
        text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          "</Relationships>"
      },
      {
        name: "xl/workbook.xml",
        text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          "<sheets>" +
          '<sheet name="逐项" sheetId="1" r:id="rId1"/>' +
          '<sheet name="一行" sheetId="2" r:id="rId2"/>' +
          "</sheets></workbook>"
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
          "</Relationships>"
      },
      { name: "xl/worksheets/sheet1.xml", text: sheetXml(vertical, [16, 42, 60]) },
      { name: "xl/worksheets/sheet2.xml", text: sheetXml(wide) }
    ];
    return zipStore(files);
  }

  function fileName(form) {
    var who = textOf(form.oemWriter).trim() || "未署名";
    who = who.replace(/[\\/:*?"<>|\s]+/g, "").slice(0, 24) || "未署名";
    var now = new Date();
    function pad(n) { return (n < 10 ? "0" : "") + n; }
    return "市场情况-" + who + "-" + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + "-" + pad(now.getHours()) + pad(now.getMinutes()) + ".xlsx";
  }

  function downloadExcel(form) {
    var bytes = workbook(formRows(form));
    var blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    var link = document.createElement("a");
    var url = URL.createObjectURL(blob);
    link.href = url;
    link.download = fileName(form);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    return link.download;
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
    var excel = makeButton("下载 Excel", false);
    var status = document.createElement("span");
    status.id = "mx-intake-status";
    status.style.cssText = "font-size:14px;color:#57534e;";
    function setBusy(busy) {
      save.disabled = busy;
      upload.disabled = busy;
      excel.disabled = busy;
    }
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
      setBusy(true);
      status.textContent = "正在上传";
      lookupIp().then(function (ip) {
        return encrypt({ savedAt: new Date().toISOString(), ip: ip, intake: form });
      }).then(function (payload) {
        return postPayload(payload);
      }).then(function () {
        status.textContent = "上传成功";
      }).catch(function () {
        status.textContent = "上传没有成功，请再试一次";
      }).then(function () {
        setBusy(false);
      });
    });
    excel.addEventListener("click", function () {
      var form = readForm();
      if (!form) {
        status.textContent = "先填写后再下载";
        return;
      }
      try {
        var name = downloadExcel(form);
        status.textContent = "已下载 Excel：" + name;
      } catch (err) {
        status.textContent = "Excel 没有下载成功，请再试一次";
      }
    });
    bar.appendChild(save);
    bar.appendChild(upload);
    bar.appendChild(excel);
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
