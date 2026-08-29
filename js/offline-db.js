/* ==========================================================
   Al Ola Center - Local First / Offline Sync Layer
   يحافظ على نفس واجهة Firebase الموجودة في المشروع، لكن:
   - القراءة من IndexedDB عند انقطاع الإنترنت.
   - الكتابة تحفظ محلياً فوراً وتدخل طابور المزامنة.
   - عند عودة الإنترنت تتم المزامنة تلقائياً.
   - لا يغيّر شكل الواجهة أو أسماء الحقول الحالية.
   ========================================================== */
(() => {
  const DB_NAME = "al-ola-local-first";
  const DB_VERSION = 1;
  const TREE_STORE = "tree";
  const QUEUE_STORE = "queue";
  const META_STORE = "meta";
  const ROOT_KEY = "firebase-tree";
  const SYNC_EVENT = "alola-sync-state";

  let idbPromise;
  let syncRunning = false;
  const listeners = new Map();

  function openDB() {
    if (idbPromise) return idbPromise;
    idbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const dbx = req.result;
        if (!dbx.objectStoreNames.contains(TREE_STORE)) dbx.createObjectStore(TREE_STORE);
        if (!dbx.objectStoreNames.contains(QUEUE_STORE)) dbx.createObjectStore(QUEUE_STORE, { keyPath: "id" });
        if (!dbx.objectStoreNames.contains(META_STORE)) dbx.createObjectStore(META_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return idbPromise;
  }

  async function idbGet(store, key) {
    const d = await openDB();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(store, "readonly");
      const r = tx.objectStore(store).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  async function idbPut(store, value, key) {
    const d = await openDB();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(store, "readwrite");
      const r = key === undefined ? tx.objectStore(store).put(value) : tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve(r.result);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbDelete(store, key) {
    const d = await openDB();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(store, "readwrite");
      tx.objectStore(store).delete(key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbAll(store) {
    const d = await openDB();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(store, "readonly");
      const r = tx.objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    });
  }

  function normalizePath(path) {
    return String(path || "").replace(/^\/+|\/+$/g, "");
  }

  function parts(path) { return normalizePath(path).split("/").filter(Boolean); }

  function getAt(tree, path) {
    const ps = parts(path);
    let cur = tree;
    for (const p of ps) {
      if (cur == null || typeof cur !== "object" || !(p in cur)) return null;
      cur = cur[p];
    }
    return cur === undefined ? null : structuredClone(cur);
  }

  function ensureParent(tree, path) {
    const ps = parts(path);
    let cur = tree;
    for (const p of ps) {
      if (!cur[p] || typeof cur[p] !== "object") cur[p] = {};
      cur = cur[p];
    }
    return cur;
  }

  function setAt(tree, path, value) {
    const ps = parts(path);
    if (!ps.length) return value === null ? {} : structuredClone(value);
    const parent = ensureParent(tree, ps.slice(0, -1).join("/"));
    parent[ps[ps.length - 1]] = structuredClone(value);
    return tree;
  }

  function updateAt(tree, path, updates) {
    if (!updates || typeof updates !== "object") return tree;
    for (const [key, value] of Object.entries(updates)) {
      const full = key.includes("/") ? normalizePath(key) : (normalizePath(path) ? normalizePath(path) + "/" + key : key);
      if (value === null) removeAt(tree, full); else setAt(tree, full, value);
    }
    return tree;
  }

  function removeAt(tree, path) {
    const ps = parts(path);
    if (!ps.length) return {};
    let cur = tree;
    for (let i = 0; i < ps.length - 1; i++) {
      if (!cur || typeof cur !== "object" || !(ps[i] in cur)) return tree;
      cur = cur[ps[i]];
    }
    if (cur && typeof cur === "object") delete cur[ps[ps.length - 1]];
    return tree;
  }

  async function loadTree() { return (await idbGet(TREE_STORE, ROOT_KEY)) || {}; }
  async function saveTree(tree) { await idbPut(TREE_STORE, structuredClone(tree), ROOT_KEY); }

  function fakeSnapshot(path, value) {
    const data = structuredClone(value);
    return {
      key: parts(path).pop() || null,
      val: () => structuredClone(data),
      exists: () => data !== null && data !== undefined,
      numChildren: () => data && typeof data === "object" ? Object.keys(data).length : 0,
      child: (p) => fakeSnapshot(normalizePath(path) + "/" + p, getAt(data, p)),
      forEach: (cb) => {
        if (!data || typeof data !== "object") return false;
        return Object.entries(data).some(([k, v]) => cb(fakeSnapshot(normalizePath(path) + "/" + k, v)) === true);
      }
    };
  }

  function dispatchLocal(path, tree) {
    const p = normalizePath(path);
    for (const [key, entries] of listeners) {
      if (key === p || key.startsWith(p + "/") || p.startsWith(key + "/")) {
        const val = getAt(tree, key);
        entries.forEach(fn => { try { fn(fakeSnapshot(key, val)); } catch (e) { console.error(e); } });
      }
    }
  }

  async function mutateLocal(op, path, payload) {
    const tree = await loadTree();
    let result;
    if (op === "set") { const next = setAt(tree, path, payload); result = getAt(next, path); }
    else if (op === "update") { updateAt(tree, path, payload); result = getAt(tree, path); }
    else if (op === "remove") { removeAt(tree, path); result = null; }
    else if (op === "push") { const key = payload.__key; setAt(tree, normalizePath(path) + "/" + key, payload.value); result = key; }
    else if (op === "transaction") { const current = getAt(tree, path); const next = payload(current); if (next !== undefined) setAt(tree, path, next); result = next; }
    await saveTree(tree);
    dispatchLocal(path, tree);
    return result;
  }

  async function enqueue(op, path, payload) {
    await idbPut(QUEUE_STORE, { id: crypto.randomUUID ? crypto.randomUUID() : (Date.now() + "-" + Math.random()), op, path: normalizePath(path), payload, createdAt: Date.now() });
    setSyncState();
  }

  function setSyncState() {
    Promise.resolve(idbAll(QUEUE_STORE)).then(q => {
      const pending = q.length;
      window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: { pending, online: navigator.onLine, syncing: syncRunning } }));
      const el = document.getElementById("offlineSyncStatus");
      if (el) {
        el.textContent = pending ? `📴 ${pending} عملية محفوظة محلياً` : (navigator.onLine ? "🟢 متصل ومتزامن" : "📴 وضع أوفلاين");
        el.className = pending ? "offline-sync pending" : (navigator.onLine ? "offline-sync online" : "offline-sync offline");
      }
    });
  }

  async function onlineWrite(ref, op, payload, localResult) {
    if (!navigator.onLine) { await enqueue(op, ref.path, payload); return localResult; }
    try {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("network-timeout")), 5000));
      let promise;
      if (op === "set") promise = ref.raw.set(payload);
      else if (op === "update") promise = ref.raw.update(payload);
      else if (op === "remove") promise = ref.raw.remove();
      else if (op === "push") promise = ref.raw.child(payload.__key).set(payload.value);
      else if (op === "transaction") promise = ref.raw.set(payload.result);
      await Promise.race([promise, timeout]);
      return localResult;
    } catch (e) {
      await enqueue(op, ref.path, payload);
      return localResult;
    }
  }

  async function syncQueue() {
    if (syncRunning || !navigator.onLine) return;
    syncRunning = true; setSyncState();
    try {
      const queue = (await idbAll(QUEUE_STORE)).sort((a,b) => a.createdAt - b.createdAt);
      for (const item of queue) {
        if (!navigator.onLine) break;
        try {
          const raw = db.ref(item.path);
          if (item.op === "set") await raw.set(item.payload);
          else if (item.op === "update") await raw.update(item.payload);
          else if (item.op === "remove") await raw.remove();
          else if (item.op === "push") await raw.child(item.payload.__key).set(item.payload.value);
          else if (item.op === "transaction") await raw.set(item.payload.result);
          await idbDelete(QUEUE_STORE, item.id);
        } catch (e) { break; }
      }
    } finally {
      syncRunning = false; setSyncState();
      if (navigator.onLine) refreshFromServer();
    }
  }

  async function refreshFromServer() {
    if (!navigator.onLine) return;
    // تحميل العقد الأساسية التي يستخدمها المشروع، بحيث يبدأ الهاتف من نسخة محلية كاملة بعد أول اتصال.
    const roots = ["students", "teachers", "absentees", "paymentRequests", "financeArchive", "supportChats", "stats", "settings", "presence", "systemBackups"];
    const tree = await loadTree();
    let changed = false;
    for (const path of roots) {
      try {
        const snap = await Promise.race([
          db.ref(path).get(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 6000))
        ]);
        const val = snap.exists() ? snap.val() : null;
        setAt(tree, path, val);
        changed = true;
        dispatchLocal(path, tree);
      } catch (_) {}
    }
    if (changed) await saveTree(tree);
  }

  function makeRef(path) {
    const p = normalizePath(path);
    const raw = db.ref(p);
    return {
      path: p,
      raw,
      get: async () => {
        if (navigator.onLine) {
          try {
            const snap = await Promise.race([raw.get(), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3500))]);
            const tree = await loadTree();
            setAt(tree, p, snap.exists() ? snap.val() : null);
            await saveTree(tree); dispatchLocal(p, tree);
            return snap;
          } catch (_) {}
        }
        return fakeSnapshot(p, getAt(await loadTree(), p));
      },
      set: async (value) => {
        const local = await mutateLocal("set", p, value);
        return onlineWrite({ path: p, raw }, "set", value, local);
      },
      update: async (updates) => {
        const local = await mutateLocal("update", p, updates);
        return onlineWrite({ path: p, raw }, "update", updates, local);
      },
      remove: async () => {
        const local = await mutateLocal("remove", p, null);
        return onlineWrite({ path: p, raw }, "remove", null, local);
      },
      push: (value) => {
        const key = "local_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
        const payload = { __key: key, value: structuredClone(value) };
        const promise = mutateLocal("push", p, payload).then(local => onlineWrite({ path: p, raw }, "push", payload, local));
        return { key, path: p + "/" + key, set: (v) => makeRef(p + "/" + key).set(v), update: (u) => makeRef(p + "/" + key).update(u), remove: () => makeRef(p + "/" + key).remove(), then: (...args) => promise.then(...args), catch: (...args) => promise.catch(...args) };
      },
      transaction: async (fn) => {
        const current = getAt(await loadTree(), p);
        const result = fn(structuredClone(current));
        const local = await mutateLocal("transaction", p, { result });
        return onlineWrite({ path: p, raw }, "transaction", { result }, local);
      },
      on: (event, callback) => {
        if (event !== "value") return raw.on(event, callback);
        if (!listeners.has(p)) listeners.set(p, new Set());
        listeners.get(p).add(callback);
        loadTree().then(tree => callback(fakeSnapshot(p, getAt(tree, p)))).catch(() => {});
        if (navigator.onLine) {
          raw.on("value", async snap => {
            try {
              const tree = await loadTree();
              setAt(tree, p, snap.exists() ? snap.val() : null);
              await saveTree(tree);
              callback(snap);
            } catch (_) { callback(snap); }
          });
        }
        return callback;
      },
      off: (event, callback) => {
        if (event === "value" && listeners.has(p)) {
          if (callback) listeners.get(p).delete(callback); else listeners.get(p).clear();
        }
        return raw.off(event, callback);
      },
      onDisconnect: () => raw.onDisconnect(),
      child: (name) => makeRef(p ? p + "/" + name : name)
    };
  }

  window.offlineDb = { ref: (path) => makeRef(path) };
  window.AlOlaOffline = { syncQueue, refreshFromServer, setSyncState };

  function createStatus() {
    if (document.getElementById("offlineSyncStatus")) return;
    const el = document.createElement("div");
    el.id = "offlineSyncStatus";
    el.className = "offline-sync offline";
    el.textContent = navigator.onLine ? "🟢 متصل" : "📴 وضع أوفلاين";
    document.body.appendChild(el);
  }

  window.addEventListener("online", () => { setSyncState(); syncQueue(); });
  window.addEventListener("offline", setSyncState);
  window.addEventListener("load", () => { createStatus(); setSyncState(); if (navigator.onLine) { syncQueue(); refreshFromServer(); } });
})();
