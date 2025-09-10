// app.js — Enhanced version with all requested features

// Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyA-xV3iuv-KAE_-xhiXZSPCTn54EgYUD40",
  authDomain: "presensi-online-f0964.firebaseapp.com",
  projectId: "presensi-online-f0964",
  storageBucket: "presensi-online-f0964.firebasestorage.app",
  messagingSenderId: "895308244103",
  appId: "1:895308244103:web:ab240a8be762a44f49c422",
  measurementId: "G-E9C7760C2S"
};

// Cloudinary
const CLOUD_NAME = "dn2o2vf04";
const UPLOAD_PRESET = "presensi_unsigned";

// UID roles
const ADMIN_UIDS = new Set([
  "odO8ZtMgTKeao0SDuy9L3gUmkx02", // annisa@fupa.id
  "ujHnWTnftGh6scTI8cQyN8fhmOB2"  // karomi@fupa.id
]);
const KARYAWAN_UIDS = new Set([
  "HD4EsoL2ykgwQeBl6RP1WfrcCKw1", // cabang1@fupa.id
  "FD69ceLyhqedlBfhbLb2I0TljY03", // cabang2@fupa.id
  "h5aw8ppJSgP9PQM0Oc2HtugUAH02"  // cabang3@fupa.id
]);

// Inisialisasi Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Util UI
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const toast = (msg, type = "info") => {
  const t = $("#toast");
  if (!t) return alert(msg);
  
  t.textContent = msg;
  t.className = `toast ${type}`;
  t.style.display = "block";
  
  setTimeout(() => { 
    t.style.display = "none";
    t.className = "toast";
  }, 3000);
};

// PWA register SW
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js");
  });
}

// Notifikasi browser
async function ensureNotificationPermission() {
  try {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission !== "denied") {
      const res = await Notification.requestPermission();
      return res === "granted";
    }
    return false;
  } catch { return false; }
}

function notify(msg) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") new Notification("Presensi FUPA", { body: msg });
}

// Dapatkan server time via Firestore serverTimestamp comparator
async function getServerTime() {
  try {
    const docRef = db.collection("_meta").doc("_srv");
    await docRef.set({ t: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    const snap = await docRef.get();
    const ts = snap.get("t");
    return ts ? ts.toDate() : new Date();
  } catch (error) {
    console.error("Error getting server time:", error);
    return new Date(); // fallback
  }
}

function fmtDateTime(d) {
  const pad = (n) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtHM(d) {
  const pad = (n) => n.toString().padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function sameYMD(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Aturan hari & jam
const WINDOW = {
  berangkat: { start: { h: 4, m: 30 }, end: { h: 5, m: 30 } },
  pulang: { start: { h: 10, m: 0 }, end: { h: 11, m: 0 } }
};

function inWindow(d, jenis, extraLateMin = 30) {
  const w = WINDOW[jenis];
  const start = new Date(d); 
  start.setHours(w.start.h, w.start.m, 0, 0);
  
  const end = new Date(d);   
  end.setHours(w.end.h, w.end.m, 0, 0);
  
  const lateEnd = new Date(end.getTime() + extraLateMin * 60000);
  
  if (d < start) return { allowed: false, status: "dilarang" };
  if (d >= start && d <= end) return { allowed: true, status: "tepat" };
  if (d > end && d <= lateEnd) return { allowed: true, status: "terlambat" };
  
  return { allowed: false, status: "dilarang" };
}

async function getScheduleOverride(dateYMD) {
  try {
    const doc = await db.collection("_settings").doc("today").get();
    if (doc.exists) {
      const d = doc.data();
      if (d.date === dateYMD) return d.mode;
    }
    return "auto";
  } catch (error) {
    console.error("Error getting schedule override:", error);
    return "auto";
  }
}

function ymd(d) {
  const pad = (n) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

// Role guard
function redirectByRole(uid, pathIfAdmin, pathIfKaryawan) {
  if (ADMIN_UIDS.has(uid)) {
    if (!location.pathname.endsWith(pathIfAdmin)) location.href = pathIfAdmin;
  } else if (KARYAWAN_UIDS.has(uid)) {
    if (!location.pathname.endsWith(pathIfKaryawan)) location.href = pathIfKaryawan;
  } else {
    auth.signOut();
    toast("Akses ditolak: akun belum diberi peran yang benar.", "error");
  }
}

function guardPage(uid, required) {
  const isAdmin = ADMIN_UIDS.has(uid);
  const isKaryawan = KARYAWAN_UIDS.has(uid);
  
  if (required === "admin" && !isAdmin) { 
    location.href = "index.html"; 
    return false; 
  }
  
  if (required === "karyawan" && !isKaryawan) { 
    location.href = "index.html"; 
    return false; 
  }
  
  return true;
}

// Auto bootstrap koleksi & dokumen penting tanpa setup manual
async function bootstrapCollections(user) {
  try {
    // users profile doc
    const up = db.collection("users").doc(user.uid);
    await up.set({
      email: user.email || "",
      role: ADMIN_UIDS.has(user.uid) ? "admin" : (KARYAWAN_UIDS.has(user.uid) ? "karyawan" : "unknown"),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // meta server tick
    await db.collection("_meta").doc("_srv").set({ t: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });

    // settings today default
    const todayDoc = db.collection("_settings").doc("today");
    if (!(await todayDoc.get()).exists) {
      await todayDoc.set({ mode: "auto", date: ymd(new Date()) });
    }
    
    // Initialize leave balance if not exists
    const leaveBalanceDoc = db.collection("leave_balance").doc(user.uid);
    if (!(await leaveBalanceDoc.get()).exists) {
      await leaveBalanceDoc.set({
        cuti: 12,
        izin: 6,
        sakit: 12,
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  } catch (error) {
    console.error("Error bootstrapping collections:", error);
    toast("Gagal menginisialisasi data pengguna", "error");
  }
}

// Auth routing untuk semua halaman
auth.onAuthStateChanged(async (user) => {
  const path = location.pathname.toLowerCase();
  
  // Show loading indicator
  $("#loadingIndicator")?.style.setProperty("display", "block");
  
  try {
    if (!user) {
      // Cegah akses langsung
      if (path.endsWith("karyawan.html") || path.endsWith("admin.html")) {
        location.href = "index.html";
        return;
      }
      
      // halaman login tidak butuh apa-apa
      if (path.endsWith("index.html") || path.endsWith("/")) {
        bindLoginPage();
      }
      return;
    }

    await bootstrapCollections(user);

    // Update server time live
    startServerClock("#serverTime");

    // Routing per halaman
    if (path.endsWith("index.html") || path.endsWith("/")) {
      // Setelah login, arahkan sesuai role
      redirectByRole(user.uid, "admin.html", "karyawan.html");
      return;
    }

    if (path.endsWith("karyawan.html")) {
      if (!guardPage(user.uid, "karyawan")) return;
      await ensureNotificationPermission();
      await bindKaryawanPage(user);
    }

    if (path.endsWith("admin.html")) {
      if (!guardPage(user.uid, "admin")) return;
      await ensureNotificationPermission();
      await bindAdminPage(user);
    }
  } catch (error) {
    console.error("Error in auth state change:", error);
    toast("Terjadi kesalahan sistem", "error");
  } finally {
    // Hide loading indicator
    $("#loadingIndicator")?.style.setProperty("display", "none");
  }
});

// Halaman login
function bindLoginPage() {
  const loginBtn = $("#loginBtn");
  if (!loginBtn) return;
  
  // Add loading text element if not exists
  if (!$("#loginText")) {
    const loginText = document.createElement("span");
    loginText.id = "loginText";
    loginText.textContent = "Masuk";
    loginBtn.appendChild(loginText);
  }
  
  loginBtn.onclick = async () => {
    const email = $("#email").value.trim();
    const pass = $("#password").value.trim();
    
    if (!email || !pass) { 
      toast("Isi email dan kata sandi.", "error"); 
      return; 
    }
    
    try {
      // Show loading state
      loginBtn.disabled = true;
      $("#loginText").textContent = "Loading...";
      
      await auth.signInWithEmailAndPassword(email, pass);
      toast("Login berhasil, mengalihkan...", "success");
      // onAuthStateChanged akan redirect by role
    } catch (e) {
      console.error("Login error:", e);
      toast("Gagal masuk. Periksa kembali kredensial.", "error");
      loginBtn.disabled = false;
      $("#loginText").textContent = "Masuk";
    }
  };
}

// Jam server live
async function startServerClock(sel) {
  const el = $(sel);
  if (!el) return;
  
  const tick = async () => {
    try {
      const t = await getServerTime();
      el.textContent = `Waktu server: ${fmtDateTime(t)} WIB`;
    } catch {
      el.textContent = `Waktu server: tidak tersedia`;
    }
  };
  
  await tick();
  setInterval(tick, 10_000);
}

// Ambil lokasi
function getLocation(timeout = 8000) {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error("Geolokasi tidak didukung."));
    
    navigator.geolocation.getCurrentPosition(
      (pos) => res({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => rej(err),
      { enableHighAccuracy: true, timeout, maximumAge: 2_000 }
    );
  });
}

// Kamera
async function startCamera(videoEl) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ 
      video: { facingMode: "user" }, 
      audio: false 
    });
    
    videoEl.srcObject = stream;
    await videoEl.play();
    return stream;
  } catch (e) {
    console.error("Camera error:", e);
    toast("Tidak bisa mengakses kamera.", "error");
    throw e;
  }
}

function captureToCanvas(videoEl, canvasEl) {
  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;
  const MAXW = 720;
  const scale = Math.min(1, MAXW / w);
  
  canvasEl.width = Math.round(w * scale);
  canvasEl.height = Math.round(h * scale);
  
  const ctx = canvasEl.getContext("2d");
  ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
}

// Kompres gambar ke kualitas kecil (≤30 KB)
async function canvasToCompressedBlob(canvas, targetKB = 30) {
  let quality = 0.7;
  let blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", quality));
  
  // Jika > target kb, turunkan quality secara progresif
  let attempts = 0;
  while (blob.size / 1024 > targetKB && attempts < 6 && quality > 0.3) {
    quality = Math.max(0.3, quality - 0.1);
    blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", quality));
    attempts++;
  }
  
  return blob;
}

// Upload ke Cloudinary unsigned
async function uploadToCloudinary(file) {
  try {
    const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/upload`;
    const form = new FormData();
    form.append("file", file);
    form.append("upload_preset", UPLOAD_PRESET);
    
    const r = await fetch(url, { method: "POST", body: form });
    if (!r.ok) throw new Error("Upload Cloudinary gagal");
    
    const data = await r.json();
    return data.secure_url;
  } catch (error) {
    console.error("Cloudinary upload error:", error);
    toast("Gagal mengupload gambar", "error");
    throw error;
  }
}

// Simpan presensi
async function savePresensi({ uid, nama, jenis, status, lat, lng, selfieUrl, serverDate, note = "" }) {
  try {
    const ts = serverDate || new Date();
    const doc = {
      uid, 
      nama: nama || "", 
      jenis, 
      status,
      lat, 
      lng,
      selfieUrl: selfieUrl || "",
      note,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      localTime: fmtDateTime(ts),
      ymd: ymd(ts)
    };
    
    await db.collection("presensi").add(doc);
    return true;
  } catch (error) {
    console.error("Error saving attendance:", error);
    toast("Gagal menyimpan presensi", "error");
    return false;
  }
}

// Ambil riwayat singkat karyawan dengan filter
function subscribeRiwayat(uid, cb, limit = 10, period = 'today') {
  let query = db.collection("presensi")
    .where("uid", "==", uid)
    .orderBy("createdAt", "desc");
  
  // Apply period filter
  const now = new Date();
  let startDate = new Date();
  
  switch(period) {
    case 'week':
      startDate.setDate(now.getDate() - 7);
      break;
    case 'month':
      startDate.setMonth(now.getMonth() - 1);
      break;
    case 'year':
      startDate.setFullYear(now.getFullYear() - 1);
      break;
    case 'today':
    default:
      startDate.setHours(0, 0, 0, 0);
  }
  
  if (period !== 'all') {
    query = query.where("createdAt", ">=", startDate);
  }
  
  // Apply limit
  if (limit !== 'all') {
    query = query.limit(parseInt(limit));
  }
  
  return query.onSnapshot(snap => {
    const arr = [];
    snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
    cb(arr);
  }, error => {
    console.error("Error fetching attendance history:", error);
    toast("Gagal memuat riwayat presensi", "error");
  });
}

// Notifikasi list untuk karyawan (pengumuman + progres cuti)
function subscribeNotifForKaryawan(uid, cb) {
  return db.collection("notifs")
    .where("targets", "array-contains-any", ["all", uid])
    .orderBy("createdAt", "desc")
    .limit(20)
    .onSnapshot(snap => {
      const arr = [];
      snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
      cb(arr);
    }, error => {
      console.error("Error fetching notifications:", error);
      toast("Gagal memuat notifikasi", "error");
    });
}

// Cuti collection
async function ajukanCuti(uid, nama, jenis, tanggal, catatan) {
  try {
    const cutiRef = await db.collection("cuti").add({
      uid, 
      nama, 
      jenis, 
      tanggal, 
      catatan: catatan || "",
      status: "menunggu",
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    // Buat notifikasi untuk admin
    await db.collection("notifs").add({
      type: "cuti_request",
      cutiId: cutiRef.id,
      text: `${nama} mengajukan ${jenis} pada ${tanggal}`,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      from: uid,
      targets: ["admin"]
    });
    
    return cutiRef.id;
  } catch (error) {
    console.error("Error submitting leave request:", error);
    toast("Gagal mengajukan cuti", "error");
    throw error;
  }
}

// Admin list cuti dengan filter
function subscribeCuti(cb, statusFilter = 'all') {
  let query = db.collection("cuti").orderBy("createdAt", "desc");
  
  if (statusFilter !== 'all') {
    query = query.where("status", "==", statusFilter);
  }
  
  return query.onSnapshot(snap => {
    const arr = [];
    snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
    cb(arr);
  }, error => {
    console.error("Error fetching leave requests:", error);
    toast("Gagal memuat data cuti", "error");
  });
}

async function setCutiStatus(id, status, adminUid, adminName) {
  try {
    const cutiDoc = await db.collection("cuti").doc(id).get();
    const cutiData = cutiDoc.data();
    
    await db.collection("cuti").doc(id).update({ 
      status,
      reviewedBy: adminUid,
      reviewedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    // Buat notifikasi untuk karyawan
    await db.collection("notifs").add({
      type: "cuti_response",
      cutiId: id,
      text: `Permintaan cuti ${cutiData.jenis} Anda telah ${status}`,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      from: adminUid,
      fromName: adminName,
      targets: [cutiData.uid]
    });
    
    // Jika disetujui, buat entri presensi otomatis
    if (status === "disetujui") {
      await savePresensi({
        uid: cutiData.uid,
        nama: cutiData.nama,
        jenis: cutiData.jenis,
        status: "cuti",
        lat: null,
        lng: null,
        selfieUrl: "",
        serverDate: new Date(cutiData.tanggal),
        note: `Cuti: ${cutiData.catatan || "Tanpa keterangan"}`
      });
    }
    
    return true;
  } catch (error) {
    console.error("Error updating leave status:", error);
    toast("Gagal memperbarui status cuti", "error");
    return false;
  }
}

// Pengumuman
async function kirimPengumuman(text, adminUid, adminName) {
  try {
    await db.collection("notifs").add({
      type: "announce",
      text,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      from: adminUid,
      fromName: adminName,
      targets: ["all"]
    });
    
    notify("Pengumuman terkirim ke semua karyawan.");
    return true;
  } catch (error) {
    console.error("Error sending announcement:", error);
    toast("Gagal mengirim pengumuman", "error");
    return false;
  }
}

// Jadwal wajib
async function setHariMode(mode, dateStr, adminUid, adminName) {
  try {
    await db.collection("_settings").doc("today").set({
      mode, 
      date: dateStr,
      updatedBy: adminUid,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    
    // Kirim notifikasi ke semua karyawan
    let message = "";
    if (mode === "forceOn") {
      message = "Admin memaksa presensi wajib hari ini.";
    } else if (mode === "forceOff") {
      message = "Admin memaksa presensi tidak wajib hari ini.";
    } else {
      message = "Admin mengembalikan pengaturan presensi ke mode normal.";
    }
    
    await db.collection("notifs").add({
      type: "override",
      text: message,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      from: adminUid,
      fromName: adminName,
      targets: ["all"]
    });
    
    return true;
  } catch (error) {
    console.error("Error setting day mode:", error);
    toast("Gagal menyimpan pengaturan hari", "error");
    return false;
  }
}

// Profil simpan
async function saveProfile(uid, { nama, alamat, pfpUrl, phone, department }) {
  try {
    const d = {};
    if (nama !== undefined) d.nama = nama;
    if (alamat !== undefined) d.alamat = alamat;
    if (pfpUrl !== undefined) d.pfp = pfpUrl;
    if (phone !== undefined) d.phone = phone;
    if (department !== undefined) d.department = department;
    
    d.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    
    await db.collection("users").doc(uid).set(d, { merge: true });
    return true;
  } catch (error) {
    console.error("Error saving profile:", error);
    toast("Gagal menyimpan profil", "error");
    return false;
  }
}

// Ambil profil
async function getProfile(uid) {
  try {
    const snap = await db.collection("users").doc(uid).get();
    return snap.exists ? snap.data() : {};
  } catch (error) {
    console.error("Error fetching profile:", error);
    toast("Gagal memuat profil", "error");
    return {};
  }
}

// Hapus notifikasi
async function deleteNotif(notifId) {
  try {
    await db.collection("notifs").doc(notifId).delete();
    return true;
  } catch (error) {
    console.error("Error deleting notification:", error);
    toast("Gagal menghapus notifikasi", "error");
    return false;
  }
}

// Dapatkan saldo cuti
async function getLeaveBalance(uid) {
  try {
    const doc = await db.collection("leave_balance").doc(uid).get();
    return doc.exists ? doc.data() : { cuti: 12, izin: 6, sakit: 12 };
  } catch (error) {
    console.error("Error fetching leave balance:", error);
    return { cuti: 12, izin: 6, sakit: 12 }; // Default values
  }
}

// Halaman Karyawan bindings
async function bindKaryawanPage(user) {
  // Show loading
  $("#loadingIndicator")?.style.setProperty("display", "block");
  
  let stream = null;
  let unsubLog = null;
  let unsubNotif = null;
  
  try {
    const video = $("#cam");
    const canvas = $("#canvas");
    const preview = $("#preview");
    const jenisSel = $("#jenis");
    const statusText = $("#statusText");
    const statusChip = $("#statusChip");
    const locText = $("#locText");

    // Guard kamera
    stream = await startCamera(video);

    // Lokasi
    let coords = null;
    try {
      coords = await getLocation();
      locText.textContent = `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
    } catch {
      locText.textContent = "Lokasi tidak aktif";
    }

    // Profil muat
    const profile = await getProfile(user.uid);
    if (profile.pfp) $("#pfp").src = profile.pfp;
    if (profile.nama) $("#nama").value = profile.nama;
    if (profile.alamat) $("#alamat").value = profile.alamat;
    if (profile.phone) $("#phone").value = profile.phone;
    if (profile.department) $("#department").value = profile.department;

    // Muat saldo cuti
    const leaveBalance = await getLeaveBalance(user.uid);
    $("#cutiBalance").textContent = leaveBalance.cuti;
    $("#izinBalance").textContent = leaveBalance.izin;
    $("#sakitBalance").textContent = leaveBalance.sakit;

    // Status window
    async function refreshStatus() {
      try {
        const serverNow = await getServerTime();
        const today = ymd(serverNow);
        const override = await getScheduleOverride(today);
        const isSunday = serverNow.getDay() === 0;
        const jenis = jenisSel.value;

        let wajib = true;
        if (override === "forceOn") wajib = true;
        else if (override === "forceOff") wajib = false;
        else wajib = !isSunday;

        if (!wajib) {
          statusText.textContent = "Hari ini tidak wajib presensi";
          statusChip.className = "status s-warn";
          return { allowed: false, reason: "not-required" };
        }

        const win = inWindow(serverNow, jenis, 30);
        if (!win.allowed) {
          statusText.textContent = "Di luar jam presensi";
          statusChip.className = "status s-bad";
          return { allowed: false, reason: "out-of-window" };
        } else {
          statusText.textContent = win.status === "tepat" ? "Tepat waktu" : "Terlambat";
          statusChip.className = "status " + (win.status === "tepat" ? "s-good" : "s-warn");
          return { allowed: true, status: win.status, serverNow };
        }
      } catch (error) {
        console.error("Error refreshing status:", error);
        return { allowed: false, reason: "error" };
      }
    }

    let lastStatus = await refreshStatus();
    setInterval(async () => { lastStatus = await refreshStatus(); }, 30_000);

    // Snap
    $("#snapBtn").onclick = () => {
      captureToCanvas(video, canvas);
      canvas.style.display = "block";
      preview.style.display = "none";
      toast("Foto diambil. Anda bisa langsung upload.");
    };

    // Upload
    $("#uploadBtn").onclick = async () => {
      // Periksa status window lagi
      lastStatus = await refreshStatus();
      if (!lastStatus.allowed) {
        toast("Presensi ditolak: di luar jadwal atau tidak wajib.", "error");
        return;
      }
      
      if (!coords) {
        toast("Lokasi belum aktif.", "error");
        return;
      }
      
      // Pastikan ada gambar di canvas
      if (canvas.width === 0 || canvas.height === 0) {
        toast("Ambil selfie dulu.", "error");
        return;
      }
      
      try {
        const blob = await canvasToCompressedBlob(canvas, 30);
        const url = await uploadToCloudinary(blob);
        preview.src = url;
        preview.style.display = "block";
        
        // Simpan presensi
        const nama = ($("#nama")?.value || profile.nama || user.email.split("@")[0]).trim();
        const jenis = jenisSel.value;
        const status = lastStatus.status === "tepat" ? "tepat" : "terlambat";
        const note = $("#attendanceNote")?.value || "";
        
        const success = await savePresensi({
          uid: user.uid,
          nama,
          jenis,
          status,
          lat: coords.lat,
          lng: coords.lng,
          selfieUrl: url,
          serverDate: lastStatus.serverNow,
          note
        });
        
        if (success) {
          toast("Presensi tersimpan.", "success");
          notify(`Presensi ${jenis} tercatat (${status}).`);
          
          // Reset form
          canvas.width = 0;
          canvas.height = 0;
          canvas.style.display = "none";
          if ($("#attendanceNote")) $("#attendanceNote").value = "";
        }
      } catch (e) {
        console.error("Upload error:", e);
        toast("Gagal menyimpan presensi.", "error");
      }
    };

    // Riwayat singkat dengan filter
    let currentLimit = 10;
    let currentPeriod = 'today';
    
    function refreshRiwayat() {
      if (unsubLog) unsubLog();
      
      unsubLog = subscribeRiwayat(user.uid, (items) => {
        const list = $("#logList");
        if (!list) return;
        
        list.innerHTML = "";
        
        if (items.length === 0) {
          list.innerHTML = '<div class="empty-state">Tidak ada riwayat presensi</div>';
          return;
        }
        
        items.forEach(it => {
          const badge = it.status === "tepat" ? "s-good" : (it.status === "terlambat" ? "s-warn" : "s-bad");
          const el = document.createElement("div");
          el.className = "row";
          el.style.justifyContent = "space-between";
          el.innerHTML = `
            <div class="row" style="gap:8px">
              <span class="material-symbols-rounded">schedule</span>
              <b>${it.localTime}</b>
              <span>•</span>
              <span>${it.jenis}</span>
            </div>
            <span class="status ${badge}">${it.status}</span>
          `;
          list.appendChild(el);
        });
      }, currentLimit, currentPeriod);
    }
    
    // Terapkan filter riwayat
    if ($("#riwayatFilter")) {
      $("#riwayatFilter").onchange = () => {
        currentPeriod = $("#riwayatFilter").value;
        refreshRiwayat();
      };
    }
    
    if ($("#riwayatLimit")) {
      $("#riwayatLimit").onchange = () => {
        currentLimit = $("#riwayatLimit").value;
        refreshRiwayat();
      };
    }
    
    refreshRiwayat();

    // Notifikasi dialog
    $("#notifBtn").onclick = () => $("#notifDlg").showModal();
    
    unsubNotif = subscribeNotifForKaryawan(user.uid, (items) => {
      const list = $("#notifList");
      if (!list) return;
      
      list.innerHTML = "";
      
      if (items.length === 0) {
        list.innerHTML = '<div class="empty-state">Tidak ada notifikasi</div>';
        return;
      }
      
      items.forEach(it => {
        const el = document.createElement("div");
        el.className = "card";
        const sub = it.type === "announce" ? "Pengumuman" : 
                   it.type === "cuti_response" ? "Status Cuti" : "Info";
        
        el.innerHTML = `
          <div style="font-weight:700">${sub}</div>
          <div style="opacity:.8; margin-top:4px">${it.text || "(tanpa teks)"}</div>
          <div style="text-align:right; margin-top:8px">
            <button class="btn delete-notif" data-id="${it.id}" style="padding:4px 8px; font-size:12px">Hapus</button>
          </div>
        `;
        
        list.appendChild(el);
      });
      
      // Tambahkan event listener untuk tombol hapus
      $$(".delete-notif").forEach(btn => {
        btn.onclick = async () => {
          const success = await deleteNotif(btn.dataset.id);
          if (success) toast("Notifikasi dihapus");
        };
      });
    });

    // Cuti FAB
    $("#cutiFab").onclick = () => $("#cutiDlg").showModal();
    $("#ajukanCutiBtn").onclick = async () => {
      const jenis = $("#cutiJenis").value;
      const tanggal = $("#cutiTanggal").value;
      const catatan = $("#cutiCatatan").value.trim();
      
      if (!tanggal) { 
        toast("Pilih tanggal cuti.", "error"); 
        return; 
      }
      
      // Check leave balance
      const balance = await getLeaveBalance(user.uid);
      if (balance[jenis] <= 0) {
        toast(`Tidak ada ${jenis} tersisa`, "error");
        return;
      }
      
      const nama = ($("#nama")?.value || profile.nama || user.email.split("@")[0]).trim();
      
      try {
        await ajukanCuti(user.uid, nama, jenis, tanggal, catatan);
        toast("Permintaan cuti dikirim.", "success");
        notify("Permintaan cuti terkirim.");
        $("#cutiDlg").close();
        
        // Update UI balance
        balance[jenis]--;
        $(`#${jenis}Balance`).textContent = balance[jenis];
      } catch (error) {
        console.error("Error submitting leave:", error);
        toast("Gagal mengajukan cuti", "error");
      }
    };

    // Profil dialog
    $("#profileBtn").onclick = () => $("#profileDlg").showModal();
    $("#saveProfileBtn").onclick = async () => {
      try {
        let pfpUrl;
        const file = $("#pfpFile").files?.[0];
        
        if (file) {
          // Kompres gambar
          const imgEl = document.createElement("img");
          imgEl.src = URL.createObjectURL(file);
          await new Promise(r => imgEl.onload = r);
          
          const c = document.createElement("canvas");
          const scale = Math.min(1, 512 / Math.max(imgEl.width, imgEl.height));
          c.width = Math.max(64, Math.round(imgEl.width * scale));
          c.height = Math.max(64, Math.round(imgEl.height * scale));
          
          const ctx = c.getContext("2d");
          ctx.drawImage(imgEl, 0, 0, c.width, c.height);
          
          const pfpBlob = await canvasToCompressedBlob(c, 30);
          pfpUrl = await uploadToCloudinary(pfpBlob);
          $("#pfp").src = pfpUrl;
        }
        
        const nama = $("#nama").value.trim();
        const alamat = $("#alamat").value.trim();
        const phone = $("#phone").value.trim();
        const department = $("#department").value.trim();
        
        const success = await saveProfile(user.uid, { nama, alamat, pfpUrl, phone, department });
        
        if (success) {
          toast("Profil tersimpan.", "success");
          notify("Profil berhasil diperbarui.");
        }
      } catch (error) {
        console.error("Error saving profile:", error);
        toast("Gagal menyimpan profil.", "error");
      }
    };
    
    $("#logoutBtn").onclick = async () => { 
      try {
        await auth.signOut(); 
        location.href = "index.html"; 
      } catch (error) {
        console.error("Logout error:", error);
        toast("Gagal logout", "error");
      }
    };

  } catch (error) {
    console.error("Error binding karyawan page:", error);
    toast("Gagal memuat halaman karyawan", "error");
  } finally {
    // Hide loading
    $("#loadingIndicator")?.style.setProperty("display", "none");
    
    // Bersihkan stream saat keluar
    window.addEventListener("beforeunload", () => {
      try { 
        if (stream) stream.getTracks().forEach(t => t.stop()); 
      } catch {}
      
      if (unsubLog) unsubLog();
      if (unsubNotif) unsubNotif();
    });
  }
}

// Halaman Admin bindings
async function bindAdminPage(user) {
  // Show loading
  $("#loadingIndicator")?.style.setProperty("display", "block");
  
  let unsubCuti = null;
  
  try {
    // Profil muat
    const profile = await getProfile(user.uid);
    if (profile.pfp) $("#adminPfp").src = profile.pfp;
    if (profile.nama) $("#adminNama").value = profile.nama;
    if (profile.alamat) $("#adminAlamat").value = profile.alamat;

    // Dialogs
    $("#adminProfileBtn").onclick = () => $("#adminProfileDlg").showModal();
    
    $("#adminLogoutBtn").onclick = async () => { 
      try {
        await auth.signOut(); 
        location.href = "index.html"; 
      } catch (error) {
        console.error("Logout error:", error);
        toast("Gagal logout", "error");
      }
    };

    // Simpan profil
    $("#adminSaveProfileBtn").onclick = async () => {
      try {
        let pfpUrl;
        const file = $("#adminPfpFile").files?.[0];
        
        if (file) {
          const imgEl = document.createElement("img");
          imgEl.src = URL.createObjectURL(file);
          await new Promise(r => imgEl.onload = r);
          
          const c = document.createElement("canvas");
          const scale = Math.min(1, 512 / Math.max(imgEl.width, imgEl.height));
          c.width = Math.max(64, Math.round(imgEl.width * scale));
          c.height = Math.max(64, Math.round(imgEl.height * scale));
          
          const ctx = c.getContext("2d");
          ctx.drawImage(imgEl, 0, 0, c.width, c.height);
          
          const blob = await canvasToCompressedBlob(c, 30);
          pfpUrl = await uploadToCloudinary(blob);
          $("#adminPfp").src = pfpUrl;
        }
        
        const nama = $("#adminNama").value.trim();
        const alamat = $("#adminAlamat").value.trim();
        
        const success = await saveProfile(user.uid, { nama, alamat, pfpUrl });
        
        if (success) {
          toast("Profil admin tersimpan.", "success");
          notify("Profil admin diperbarui.");
        }
      } catch (error) {
        console.error("Error saving admin profile:", error);
        toast("Gagal menyimpan profil admin.", "error");
      }
    };

    // Notifikasi (cuti)
    $("#notifBtn").onclick = () => $("#notifDlg").showModal();
    
    let currentCutiFilter = 'all';
    
    function refreshCuti() {
      if (unsubCuti) unsubCuti();
      
      const cutiList = $("#cutiList");
      if (!cutiList) return;
      
      cutiList.innerHTML = "<div>Memuat...</div>";
      
      unsubCuti = subscribeCuti((items) => {
        cutiList.innerHTML = "";
        
        if (items.length === 0) {
          cutiList.innerHTML = '<div class="empty-state">Tidak ada permintaan cuti</div>';
          return;
        }
        
        items.forEach(it => {
          const row = document.createElement("div");
          row.className = "card";
          row.innerHTML = `
            <div class="row" style="justify-content:space-between">
              <div class="row">
                <span class="material-symbols-rounded">person</span><b>${it.nama || it.uid}</b>
                <span>•</span>
                <span>${it.jenis}</span>
                <span>•</span>
                <span>${it.tanggal}</span>
              </div>
              <div class="row">
                <span class="status ${it.status === 'menunggu' ? 's-warn' : (it.status === 'disetujui' ? 's-good' : 's-bad')}">${it.status}</span>
              </div>
            </div>
            <div style="margin-top:8px">${it.catatan || "Tidak ada keterangan"}</div>
            <div class="row" style="justify-content:flex-end; margin-top:8px">
              <button class="btn" data-act="approve" data-id="${it.id}"><span class="material-symbols-rounded">check</span> Setujui</button>
              <button class="btn" data-act="reject" data-id="${it.id}" style="background:#222"><span class="material-symbols-rounded">close</span> Tolak</button>
            </div>
          `;
          cutiList.appendChild(row);
        });
        
        // Bind actions
        $$("[data-act='approve']").forEach(b => b.onclick = async () => {
          const success = await setCutiStatus(b.dataset.id, "disetujui", user.uid, profile.nama || user.email);
          if (success) toast("Cuti disetujui.", "success");
        });
        
        $$("[data-act='reject']").forEach(b => b.onclick = async () => {
          const success = await setCutiStatus(b.dataset.id, "ditolak", user.uid, profile.nama || user.email);
          if (success) toast("Cuti ditolak.", "success");
        });
      }, currentCutiFilter);
    }
    
    if ($("#cutiFilter")) {
      $("#cutiFilter").onchange = () => {
        currentCutiFilter = $("#cutiFilter").value;
        refreshCuti();
      };
    }
    
    refreshCuti();

    // Pengumuman
    $("#announceFab").onclick = async () => {
      const text = prompt("Tulis pengumuman:");
      if (!text) return;
      
      const success = await kirimPengumuman(text, user.uid, profile.nama || user.email);
      if (success) toast("Pengumuman terkirim.", "success");
    };
    
    $("#sendAnnounce").onclick = async () => {
      const text = $("#announceText").value.trim();
      if (!text) { 
        toast("Tulis isi pengumuman.", "error"); 
        return; 
      }
      
      const success = await kirimPengumuman(text, user.uid, profile.nama || user.email);
      
      if (success) {
        $("#announceText").value = "";
        toast("Pengumuman terkirim.", "success");
      }
    };

    // Jadwal wajib / tidak
    $("#saveSchedule").onclick = async () => {
      const mode = $("#wajibHari").value;
      const now = await getServerTime();
      
      const success = await setHariMode(mode, ymd(now), user.uid, profile.nama || user.email);
      if (success) toast("Pengaturan hari tersimpan.", "success");
    };

    // Tabel presensi + filter + export CSV
    let lastData = [];
    let currentPresensiLimit = 50;
    let currentPresensiPeriod = 'today';
    
    async function loadPresensi() {
      try {
        let q = db.collection("presensi").orderBy("createdAt", "desc");
        
        // Terapkan filter periode
        const now = new Date();
        let startDate = new Date();
        
        switch(currentPresensiPeriod) {
          case 'week':
            startDate.setDate(now.getDate() - 7);
            break;
          case 'month':
            startDate.setMonth(now.getMonth() - 1);
            break;
          case 'year':
            startDate.setFullYear(now.getFullYear() - 1);
            break;
          case 'today':
          default:
            startDate.setHours(0, 0, 0, 0);
        }
        
        if (currentPresensiPeriod !== 'all') {
          q = q.where("createdAt", ">=", startDate);
        }
        
        // Terapkan limit
        if (currentPresensiLimit !== 'all') {
          q = q.limit(parseInt(currentPresensiLimit));
        }
        
        const nama = $("#fNama").value.trim().toLowerCase();
        const tanggal = $("#fTanggal").value;
        
        const snap = await q.get();
        const arr = [];
        snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
        
        let filtered = arr;
        if (tanggal) filtered = filtered.filter(x => x.ymd === tanggal);
        if (nama) filtered = filtered.filter(x => (x.nama || "").toLowerCase().includes(nama));
        
        lastData = filtered;
        renderTable(filtered);
      } catch (error) {
        console.error("Error loading attendance:", error);
        toast("Gagal memuat data presensi", "error");
      }
    }
    
    function renderTable(rows) {
      const tb = $("#tableBody");
      if (!tb) return;
      
      tb.innerHTML = "";
      
      if (rows.length === 0) {
        tb.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px">Tidak ada data presensi</td></tr>';
        return;
      }
      
      rows.forEach(r => {
        const badge = r.status === "tepat" ? "s-good" : (r.status === "terlambat" ? "s-warn" : "s-bad");
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${r.localTime || ""}</td>
          <td>${r.nama || r.uid}</td>
          <td>${r.jenis}</td>
          <td><span class="status ${badge}">${r.status}</span></td>
          <td>${(r.lat?.toFixed?.(5) || r.lat || "")}, ${(r.lng?.toFixed?.(5) || r.lng || "")}</td>
          <td>${r.selfieUrl ? `<a href="${r.selfieUrl}" target="_blank">Lihat</a>` : "-"}</td>
        `;
        tb.appendChild(tr);
      });
    }
    
    $("#applyFilter").onclick = () => loadPresensi();
    
    $("#exportCsv").onclick = () => {
      if (!lastData.length) { 
        toast("Tidak ada data untuk diekspor.", "error"); 
        return; 
      }
      
      const cols = ["localTime", "nama", "jenis", "status", "lat", "lng", "selfieUrl", "uid", "ymd"];
      const csv = toCSV(lastData, cols);
      download(`presensi_${Date.now()}.csv`, csv);
      toast("Data berhasil diekspor", "success");
    };
    
    if ($("#presensiPeriod")) {
      $("#presensiPeriod").onchange = () => {
        currentPresensiPeriod = $("#presensiPeriod").value;
        loadPresensi();
      };
    }
    
    if ($("#presensiLimit")) {
      $("#presensiLimit").onchange = () => {
        currentPresensiLimit = $("#presensiLimit").value;
        loadPresensi();
      };
    }
    
    // Muat awal + refresh periodik ringan
    await loadPresensi();
    setInterval(loadPresensi, 20_000);

    // Create akun karyawan
    const secondApp = firebase.apps.length > 1 ? firebase.apps[1] : firebase.initializeApp(firebaseConfig, "second");
    const secondAuth = secondApp.auth();

    $("#createUserBtn").onclick = async () => {
      const email = $("#newEmail").value.trim();
      const pass = $("#newPass").value.trim();
      
      if (!email || !pass) { 
        toast("Isi email dan kata sandi.", "error"); 
        return; 
      }
      
      try {
        const cred = await secondAuth.createUserWithEmailAndPassword(email, pass);
        const uid = cred.user.uid;
        
        await db.collection("users").doc(uid).set({
          email, 
          role: "karyawan", 
          createdBy: user.uid, 
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        
        // Kembalikan secondAuth ke kosong signOut agar tidak mengganggu
        await secondAuth.signOut();
        
        toast("Akun karyawan dibuat.", "success");
        notify("Akun karyawan baru telah dibuat.");
      } catch (e) {
        console.error("Error creating user:", e);
        toast("Gagal membuat akun karyawan.", "error");
      }
    };

  } catch (error) {
    console.error("Error binding admin page:", error);
    toast("Gagal memuat halaman admin", "error");
  } finally {
    // Hide loading
    $("#loadingIndicator")?.style.setProperty("display", "none");
    
    // Bersih
    window.addEventListener("beforeunload", () => {
      if (unsubCuti) unsubCuti();
    });
  }
}

// Helper function untuk CSV
function toCSV(rows, columns) {
  const esc = (v) => `"${(v ?? "").toString().replace(/"/g, '""')}"`;
  const header = columns.map(esc).join(",");
  const body = rows.map(r => columns.map(k => esc(r[k])).join(",")).join("\n");
  return header + "\n" + body;
}

function download(filename, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  a.download = filename;
  a.click();
}

// Tambahkan loading indicator ke DOM jika belum ada
if (!$("#loadingIndicator")) {
  const loadingIndicator = document.createElement("div");
  loadingIndicator.id = "loadingIndicator";
  loadingIndicator.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(255, 255, 255, 0.8);
    display: none;
    justify-content: center;
    align-items: center;
    z-index: 9999;
  `;
  loadingIndicator.innerHTML = `
    <div style="text-align: center;">
      <div class="spinner" style="
        width: 40px;
        height: 40px;
        border: 4px solid #f3f3f3;
        border-top: 4px solid #FFB300;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin: 0 auto;
      "></div>
      <p>Memuat...</p>
    </div>
    <style>
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    </style>
  `;
  document.body.appendChild(loadingIndicator);
}