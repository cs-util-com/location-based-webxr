/* global CharLib */
// Throwaway prototype: small UI pieces shared by the editor page and the
// character maker: toasts, a button's in-progress state, list thumbnails and
// the "Import character..." flow (refuse with words, or ask for a name).
(function () {
  "use strict";

  const esc = (t) =>
    String(t).replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );

  function toast(msg, err, action) {
    const box = document.getElementById("toasts");
    if (!box) return;
    while (box.children.length >= 1) box.firstElementChild.remove();
    const t = document.createElement("div");
    t.className = "toast" + (err ? " err" : "");
    t.setAttribute("role", err ? "alert" : "status");
    const s = document.createElement("span");
    s.textContent = msg;
    t.append(s);
    if (action) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = action.label;
      b.onclick = () => {
        t.remove();
        action.run();
      };
      t.append(b);
    }
    box.append(t);
    setTimeout(() => t.remove(), err ? 7000 : action ? 6000 : 3500);
  }

  // runs fn while the button shows label and cannot be pressed again
  async function busy(btn, label, fn) {
    const old = btn ? btn.textContent : "";
    if (btn) {
      btn.disabled = true;
      btn.textContent = label;
      btn.setAttribute("aria-busy", "true");
    }
    try {
      return await fn();
    } finally {
      if (btn && btn.isConnected) {
        btn.disabled = false;
        btn.textContent = old;
        btn.removeAttribute("aria-busy");
      }
    }
  }

  // head and upper body of the resting pose, for lists
  async function cropThumb(blob) {
    const bmp = await createImageBitmap(blob);
    const w = bmp.width;
    const h = bmp.height;
    const c = CharLib.canvas(w, h);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    bmp.close && bmp.close();
    const d = ctx.getImageData(0, 0, w, h).data;
    let top = h;
    let bottom = 0;
    let left = w;
    let right = 0;
    for (let y = 0; y < h; y += 2)
      for (let x = 0; x < w; x += 2)
        if (d[(y * w + x) * 4 + 3] > 128) {
          if (y < top) top = y;
          if (y > bottom) bottom = y;
          if (x < left) left = x;
          if (x > right) right = x;
        }
    const out = CharLib.canvas(112, 144);
    if (bottom <= top) return out;
    const figH = bottom - top;
    const ch = figH * 0.62;
    const cw = (ch * 112) / 144;
    const cx = (left + right) / 2;
    out.getContext("2d").drawImage(c, cx - cw / 2, top - figH * 0.05, cw, ch, 0, 0, 112, 144);
    return out;
  }
  const thumbs = new Map();
  async function thumbUrl(id) {
    if (thumbs.has(id)) return thumbs.get(id);
    let url = "";
    try {
      const f = await CharLib.files(id);
      if (f.image) url = (await cropThumb(f.image)).toDataURL("image/png");
    } catch {
      // no thumbnail: the list shows the name only
    }
    thumbs.set(id, url);
    return url;
  }
  function forgetThumb(id) {
    thumbs.delete(id);
  }

  // "Import character...": inspects the file; a refusal is drawn into errBox,
  // a file without a name asks for one in askBox. Resolves to the accepted
  // { name, frames, framesBlob, imageBlob, record } or null.
  async function importFlow(file, errBox, askBox, chooseAgain) {
    errBox.hidden = true;
    askBox.hidden = true;
    let r;
    try {
      r = await CharLib.inspect(file);
    } catch (e) {
      const title = e instanceof CharLib.Refusal ? e.title : "This file did not work";
      const words =
        e instanceof CharLib.Refusal
          ? e.words
          : "Something unexpected went wrong while reading it. Try again, or choose another file.";
      errBox.innerHTML = `<h3>${esc(title)}</h3><p>${esc(words)}</p><p class="small dim">Nothing was added.</p><div class="row"><button class="btn small" type="button" data-again>Choose another file</button><button class="link small" type="button" data-dismiss>Close</button></div>`;
      errBox.hidden = false;
      errBox.querySelector("[data-dismiss]").onclick = () => (errBox.hidden = true);
      errBox.querySelector("[data-again]").onclick = () => chooseAgain && chooseAgain();
      errBox.scrollIntoView({ block: "nearest", behavior: "smooth" });
      toast("Not imported: " + title.toLowerCase(), true);
      return null;
    }
    if (r.name) return r;
    // accepted, but it carries no name: ask for one
    const url = URL.createObjectURL(r.imageBlob);
    askBox.innerHTML = `<div class="ask-head"><img class="thumb" alt="" src="${url}" /><div><b>This character has no name inside</b><p class="small dim">${esc(r.recordNote || "The file is a good sheet, but its name did not come with it.")} What is it called?</p></div></div>
      <label class="field">Name<input type="text" maxlength="40" placeholder="For example: Ranger Rita" data-name /></label>
      <p class="field-msg" data-msg hidden>Give it a name first, at least one letter.</p>
      <div class="row"><button class="btn primary small" type="button" data-keep>Import it</button><button class="btn small" type="button" data-cancel>Cancel</button></div>`;
    askBox.hidden = false;
    const input = askBox.querySelector("[data-name]");
    input.focus({ preventScroll: true });
    askBox.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return new Promise((res) => {
      const done = (v) => {
        askBox.hidden = true;
        URL.revokeObjectURL(url);
        res(v);
      };
      const keep = () => {
        const n = input.value.trim();
        if (!n) {
          askBox.querySelector("[data-msg]").hidden = false;
          input.focus();
          return;
        }
        done({ ...r, name: n.slice(0, 40) });
      };
      askBox.querySelector("[data-keep]").onclick = keep;
      input.onkeydown = (e) => e.key === "Enter" && keep();
      askBox.querySelector("[data-cancel]").onclick = () => {
        done(null);
        toast("Not imported");
      };
    });
  }

  // chips that hand a prepared file to onFile, for trying the import
  function preparedChips(box, onFile) {
    for (const p of CharLib.PREPARED) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip" + (p.id === "good" || p.id === "noname" ? "" : " bad");
      b.textContent = p.label;
      b.onclick = () =>
        busy(b, "Making the file...", async () =>
          onFile(await CharLib.preparedFile(p.id)),
        );
      box.append(b);
    }
  }

  // saves the exchange file: shared on a phone when the browser can, else downloaded
  async function giveFile(id) {
    const f = await CharLib.exchangeFile(id);
    if (
      matchMedia("(pointer: coarse)").matches &&
      navigator.canShare &&
      navigator.canShare({ files: [f] })
    ) {
      try {
        await navigator.share({ files: [f] });
        return "shared";
      } catch (e) {
        if (e.name === "AbortError") return "cancelled";
      }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return "saved";
  }

  window.CharUi = {
    esc,
    toast,
    busy,
    thumbUrl,
    cropThumb,
    forgetThumb,
    importFlow,
    preparedChips,
    giveFile,
  };
})();
