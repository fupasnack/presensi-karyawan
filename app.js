// app.js - Sistem Utama Presensi FUPA

// Konfigurasi Firebase
const firebaseConfig = {
  apiKey: "AIzaSyA08VBr5PfN5HB7_eub0aZ9-_FSFFHM62M",
  authDomain: "presence-system-adfd7.firebaseapp.com",
  projectId: "presence-system-adfd7",
  storageBucket: "presence-system-adfd7.firebasestorage.app",
  messagingSenderId: "84815583677",
  appId: "1:84815583677:web:12e743b9f5c2b0cb395ad4",
  measurementId: "G-HHJREDRFZB"
};

// Inisialisasi Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
let currentUser = null;

// Konfigurasi Cloudinary
const cloudinaryName = "dn2o2vf04";
const uploadPreset = "presensi_unsigned";

// UID roles
const ADMIN_UIDS = new Set([
  "DsBQ1TdWjgXvpVHUQJpF1H6jZzJ3", // karomi@fupa.id
  "xxySAjSMqKeq7SC6r5vyzes7USY2"  // annisa@fupa.id
]);

const KARYAWAN_UIDS = new Set([
  "y2MTtiGZcVcts2MkQncckAaUasm2", // x@fupa.id
  "4qwoQhWyZmatqkRYaENtz5Uw8fy1", // cabang1@fupa.id
  "UkIHdrTF6vefeuzp94ttlmxZzqk2", // cabang2@fupa.id
  "kTpmDbdBETQT7HIqT6TvpLwrbQf2", // cabang3@fupa.id
  "15FESE0b7cQFKqdJSqNBTZlHqWR2", // cabang4@fupa.id
  "1tQidUDFTjRTJdJJYIudw9928pa2", // cabang5@fupa.id
  "7BCcTwQ5wDaxWA6xbzJX9VWj1o52", // cabang6@fupa.id
  "mpyFesOjUIcs8O8Sh3tVLS8x7dA3", // cabang7@fupa.id
  "2jV2is3MQRhv7nnd1gXeqiaj11t2", // cabang8@fupa.id
  "or2AQDVY1hdpwT0YOmL4qJrgCju1", // cabang9@fupa.id
  "HNJ52lywYVaUhRK3BNEARfQsQo22"  // cabang10@fupa.id
]);

// Aturan waktu default
const DEFAULT_SCHEDULE = {
  berangkat: { start: "05:30", end: "06:00", tolerance: 20 },
  pulang: { start: "10:00", end: "11:00", tolerance: 20 }
};

// Variabel global
let userSchedule = {...DEFAULT_SCHEDULE};
let customSchedules = {};
let currentLocation = null;
let cameraStream = null;
let capturedPhoto = null;
let isCutiApproved = false;

// Utility functions
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const showToast = (msg, type = "info") => {
  const toast = $("#toast");
  if (!toast) return;
  
  toast.textContent = msg;
  toast.style.background = type === "error" ? "#c62828" : 
                          type === "success" ? "#2e7d32" : "#111";
  toast.style.display = "block";
  setTimeout(() => { toast.style.display = "none"; }, 3000);
};

// Sistem KOMPRESEXIF - Kompres gambar dan hapus metadata
async function compressAndStripExif(imageFile) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = function(e) {
      const img = new Image();
      img.onload = function() {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Hitung ukuran baru untuk kompresi
        let width = img.width;
        let height = img.height;
        const maxDimension = 800;
        
        if (width > height) {
          if (width > maxDimension) {
            height *= maxDimension / width;
            width = maxDimension;
          }
        } else {
          if (height > maxDimension) {
            width *= maxDimension / height;
            height = maxDimension;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);
        
        // Kompres ke 25KB
        let quality = 0.9;
        let compressedDataUrl;
        
        do {
          compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
          quality -= 0.1;
        } while (compressedDataUrl.length > 25000 && quality > 0.1);
        
        // Konversi kembali ke blob
        fetch(compressedDataUrl)
          .then(res => res.blob())
          .then(blob => {
            const compressedFile = new File([blob], imageFile.name, {
              type: 'image/jpeg',
              lastModified: Date.now()
            });
            resolve(compressedFile);
          })
          .catch(reject);
      };
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(imageFile);
  });
}

// Sistem Upload ke Cloudinary
async function uploadToCloudinary(imageFile) {
  try {
    const formData = new FormData();
    formData.append('file', imageFile);
    formData.append('upload_preset', uploadPreset);
    
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudinaryName}/image/upload`, {
      method: 'POST',
      body: formData
    });
    
    const data = await response.json();
    return data.secure_url;
  } catch (error) {
    console.error('Upload error:', error);
    throw new Error('Gagal mengupload gambar');
  }
}

// Sistem Status Presensi
function getPresensiStatus() {
  const now = new Date();
  const day = now.getDay(); // 0 = Minggu, 1 = Senin, dst
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const currentTime = `${hours}:${minutes}`;
  
  // Cek apakah hari Minggu
  if (day === 0) return { status: "libur", message: "Hari libur (Minggu)" };
  
  // Cek jadwal custom jika ada
  const schedule = customSchedules[currentUser.uid] || userSchedule;
  
  // Cek apakah dalam waktu presensi berangkat
  if (isTimeInRange(currentTime, schedule.berangkat.start, schedule.berangkat.end)) {
    return { 
      status: "berangkat", 
      tepatWaktu: isTimeBefore(currentTime, addMinutes(schedule.berangkat.start, schedule.berangkat.tolerance))
    };
  }
  
  // Cek apakah dalam waktu presensi pulang
  if (isTimeInRange(currentTime, schedule.pulang.start, schedule.pulang.end)) {
    return { 
      status: "pulang", 
      tepatWaktu: isTimeBefore(currentTime, addMinutes(schedule.pulang.start, schedule.pulang.tolerance))
    };
  }
  
  // Cek apakah melewati batas toleransi
  if (isTimeAfter(currentTime, addMinutes(schedule.berangkat.end, schedule.berangkat.tolerance)) &&
      isTimeBefore(currentTime, schedule.pulang.start)) {
    // Sistem ALPA - otomatis membuat presensi alpa
    createAlpaPresensi("berangkat");
    return { status: "alpa", message: "Tidak presensi berangkat (ALPA)" };
  }
  
  if (isTimeAfter(currentTime, addMinutes(schedule.pulang.end, schedule.pulang.tolerance))) {
    // Sistem ALPA - otomatis membuat presensi alpa
    createAlpaPresensi("pulang");
    return { status: "alpa", message: "Tidak presensi pulang (ALPA)" };
  }
  
  return { status: "diluar", message: "Diluar sesi presensi" };
}

// Sistem ALPA - Buat presensi alpa otomatis
async function createAlpaPresensi(jenis) {
  const now = new Date();
  const presensiData = {
    waktu: firebase.firestore.Timestamp.fromDate(now),
    nama: currentUser.displayName || "Karyawan",
    jenis: jenis,
    status: "alpa",
    uid: currentUser.uid,
    koordinat: null,
    fotoUrl: null
  };
  
  try {
    await db.collection('presensi').add(presensiData);
    console.log(`Presensi ${jenis} ALPA dicatat`);
  } catch (error) {
    console.error('Error mencatat ALPA:', error);
  }
}

// Sistem CUTI - Ajukan cuti
async function ajukanCuti(jenis, tanggal, catatan) {
  try {
    const cutiData = {
      uid: currentUser.uid,
      nama: currentUser.displayName || "Karyawan",
      jenis: jenis,
      tanggal: firebase.firestore.Timestamp.fromDate(new Date(tanggal)),
      catatan: catatan || "",
      status: "pending",
      diajukanPada: firebase.firestore.Timestamp.now()
    };
    
    await db.collection('cuti').add(cutiData);
    
    // Kirim notifikasi ke admin
    await db.collection('notifikasi').add({
      tipe: 'cuti',
      untuk: 'admin',
      data: cutiData,
      dibaca: false,
      dibuatPada: firebase.firestore.Timestamp.now()
    });
    
    showToast("Cuti berhasil diajukan", "success");
    $("#cutiDlg").close();
  } catch (error) {
    console.error('Error mengajukan cuti:', error);
    showToast("Gagal mengajukan cuti", "error");
  }
}

// Sistem CUTIDS - Otomatis buat presensi cuti
async function createCutiPresensi(uid, nama, jenis, tanggal) {
  const presensiData = {
    waktu: firebase.firestore.Timestamp.fromDate(new Date(tanggal)),
    nama: nama,
    jenis: "cuti",
    status: jenis,
    uid: uid,
    koordinat: null,
    fotoUrl: null
  };
  
  try {
    await db.collection('presensi').add(presensiData);
    console.log(`Presensi cuti (${jenis}) dicatat untuk ${nama}`);
  } catch (error) {
    console.error('Error mencatat cuti:', error);
  }
}

// Sistem Koordinat - Dapatkan lokasi pengguna
function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation tidak didukung"));
      return;
    }
    
    navigator.geolocation.getCurrentPosition(
      position => {
        currentLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };
        resolve(currentLocation);
      },
      error => {
        reject(error);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

// Sistem Kamera - Akses kamera
async function startCamera() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ 
      video: { facingMode: "user" }, 
      audio: false 
    });
    
    const video = $("#cam");
    if (video) {
      video.srcObject = cameraStream;
    }
  } catch (error) {
    console.error("Error mengakses kamera:", error);
    showToast("Tidak dapat mengakses kamera", "error");
  }
}

// Sistem Kamera - Ambil foto
function capturePhoto() {
  const video = $("#cam");
  const canvas = $("#canvas");
  const preview = $("#preview");
  
  if (!video || !canvas || !preview) return;
  
  const context = canvas.getContext('2d');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  
  capturedPhoto = canvas.toDataURL('image/png');
  preview.src = capturedPhoto;
  preview.style.display = "block";
  video.style.display = "none";
  
  // Hentikan kamera setelah mengambil foto
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
}

// Sistem Upload Presensi
async function uploadPresensi(jenis) {
  try {
    // Validasi
    if (!currentLocation) {
      showToast("Harap aktifkan lokasi", "error");
      return;
    }
    
    if (!capturedPhoto) {
      showToast("Harap ambil foto terlebih dahulu", "error");
      return;
    }
    
    // Dapatkan status presensi
    const statusPresensi = getPresensiStatus();
    
    if (statusPresensi.status === "libur") {
      showToast("Hari ini libur, tidak dapat presensi", "error");
      return;
    }
    
    if (statusPresensi.status === "diluar") {
      showToast("Diluar waktu presensi", "error");
      return;
    }
    
    if (statusPresensi.status === "alpa") {
      showToast("Anda sudah dicatat ALPA", "error");
      return;
    }
    
    // Konversi foto ke blob
    const response = await fetch(capturedPhoto);
    const blob = await response.blob();
    const file = new File([blob], `presensi-${Date.now()}.jpg`, { type: 'image/jpeg' });
    
    // Kompres dan hapus metadata
    const compressedFile = await compressAndStripExif(file);
    
    // Upload ke Cloudinary
    showToast("Mengupload foto...");
    const fotoUrl = await uploadToCloudinary(compressedFile);
    
    // Simpan data presensi
    const now = new Date();
    const presensiData = {
      waktu: firebase.firestore.Timestamp.fromDate(now),
      nama: currentUser.displayName || "Karyawan",
      jenis: jenis,
      status: statusPresensi.tepatWaktu ? "tepat waktu" : "terlambat",
      uid: currentUser.uid,
      koordinat: new firebase.firestore.GeoPoint(currentLocation.lat, currentLocation.lng),
      fotoUrl: fotoUrl
    };
    
    await db.collection('presensi').add(presensiData);
    
    showToast("Presensi berhasil dicatat", "success");
    
    // Reset form
    capturedPhoto = null;
    $("#preview").style.display = "none";
    $("#cam").style.display = "block";
    startCamera();
    
  } catch (error) {
    console.error("Error upload presensi:", error);
    showToast("Gagal mengupload presensi", "error");
  }
}

// Sistem Waktu Server
function updateServerTime() {
  const now = new Date();
  const options = { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Asia/Jakarta'
  };
  
  const timeString = now.toLocaleDateString('id-ID', options);
  const timeElement = $("#serverTime");
  
  if (timeElement) {
    timeElement.textContent = timeString;
  }
  
  // Update status presensi setiap menit
  if (now.getSeconds() === 0) {
    updateStatusPresensi();
  }
}

// Update status presensi
function updateStatusPresensi() {
  const status = getPresensiStatus();
  const statusChip = $("#statusChip");
  const statusText = $("#statusText");
  
  if (statusChip && statusText) {
    statusText.textContent = status.message || status.status;
    
    // Update kelas berdasarkan status
    statusChip.className = "status ";
    if (status.status === "tepat waktu") statusChip.classList.add("s-good");
    else if (status.status === "terlambat") statusChip.classList.add("s-warn");
    else if (status.status === "alpa" || status.status === "diluar") statusChip.classList.add("s-bad");
    else statusChip.classList.add("s-warn"); // default
  }
}

// Sistem DELLTE - Hapus notifikasi lama
async function cleanupOldNotifications() {
  try {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const snapshot = await db.collection('notifikasi')
      .where('dibuatPada', '<=', firebase.firestore.Timestamp.fromDate(sevenDaysAgo))
      .get();
    
    const batch = db.batch();
    snapshot.docs.forEach(doc => {
      // Jangan hapus notifikasi dari sistem tertentu
      const data = doc.data();
      if (!['OCD', 'CUTIDS', 'CSVMD', 'PAG'].includes(data.tipe)) {
        batch.delete(doc.ref);
      }
    });
    
    await batch.commit();
    console.log("Notifikasi lama dihapus");
  } catch (error) {
    console.error("Error membersihkan notifikasi:", error);
  }
}

// Sistem PAG - Kirim pengumuman
async function sendPengumuman(isi, target = "all") {
  try {
    const pengumumanData = {
      dari: currentUser.uid,
      dariNama: currentUser.displayName || "Admin",
      isi: isi,
      target: target,
      dibuatPada: firebase.firestore.Timestamp.now()
    };
    
    await db.collection('pengumuman').add(pengumumanData);
    
    // Kirim notifikasi ke target
    await db.collection('notifikasi').add({
      tipe: 'pengumuman',
      untuk: target === "all" ? "all" : target,
      data: pengumumanData,
      dibaca: false,
      dibuatPada: firebase.firestore.Timestamp.now()
    });
    
    showToast("Pengumuman berhasil dikirim", "success");
  } catch (error) {
    console.error("Error mengirim pengumuman:", error);
    showToast("Gagal mengirim pengumuman", "error");
  }
}

// Sistem CSVMD - Ekspor data ke CSV
async function exportToCSV(filterNama = "", filterWaktu = "harian") {
  try {
    let query = db.collection('presensi');
    
    // Terapkan filter nama jika ada
    if (filterNama) {
      // Untuk filter nama, kita perlu mendapatkan UID dari nama
      const usersSnapshot = await db.collection('users')
        .where('nama', '>=', filterNama)
        .where('nama', '<=', filterNama + '\uf8ff')
        .get();
      
      const uids = usersSnapshot.docs.map(doc => doc.id);
      if (uids.length > 0) {
        query = query.where('uid', 'in', uids);
      }
    }
    
    // Terapkan filter waktu
    const now = new Date();
    let startDate, endDate;
    
    switch (filterWaktu) {
      case "harian":
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        break;
      case "mingguan":
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + 7);
        break;
      case "bulanan":
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        break;
      case "tahunan":
        startDate = new Date(now.getFullYear(), 0, 1);
        endDate = new Date(now.getFullYear() + 1, 0, 1);
        break;
      default:
        // Periode default adalah bulan berjalan
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    }
    
    query = query.where('waktu', '>=', firebase.firestore.Timestamp.fromDate(startDate))
                 .where('waktu', '<', firebase.firestore.Timestamp.fromDate(endDate));
    
    const snapshot = await query.get();
    
    // Format STDR: Kelompokkan berdasarkan nama, urutkan berdasarkan waktu
    const dataByUser = {};
    
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      if (!dataByUser[data.nama]) {
        dataByUser[data.nama] = [];
      }
      dataByUser[data.nama].push({
        waktu: data.waktu.toDate().toLocaleString('id-ID'),
        jenis: data.jenis,
        status: data.status,
        koordinat: data.koordinat ? `${data.koordinat.latitude}, ${data.koordinat.longitude}` : "Tidak ada",
        fotoUrl: data.fotoUrl || "Tidak ada"
      });
    });
    
    // Urutkan berdasarkan nama
    const sortedNames = Object.keys(dataByUser).sort();
    
    // Buat konten CSV
    let csvContent = "Nama,Waktu,Jenis,Status,Koordinat,URL Foto\n";
    
    sortedNames.forEach(nama => {
      // Urutkan data berdasarkan waktu untuk setiap user
      dataByUser[nama].sort((a, b) => new Date(a.waktu) - new Date(b.waktu));
      
      dataByUser[nama].forEach(entry => {
        csvContent += `"${nama}","${entry.waktu}","${entry.jenis}","${entry.status}","${entry.koordinat}","${entry.fotoUrl}"\n`;
      });
    });
    
    // Download file CSV
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `presensi-${filterWaktu}-${new Date().toISOString().slice(0,10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showToast("CSV berhasil diunduh", "success");
  } catch (error) {
    console.error("Error ekspor CSV:", error);
    showToast("Gagal mengekspor CSV", "error");
  }
}

// Sistem Sf Waktu - Atur jadwal custom
async function setCustomSchedule(target, berangkat, pulang, libur) {
  try {
    const scheduleData = {
      berangkat: {
        start: berangkat.start,
        end: berangkat.end,
        tolerance: userSchedule.berangkat.tolerance
      },
      pulang: {
        start: pulang.start,
        end: pulang.end,
        tolerance: userSchedule.pulang.tolerance
      },
      libur: libur || [0] // 0 = Minggu
    };
    
    if (target === "all") {
      // Simpan sebagai jadwal default untuk semua user
      userSchedule = scheduleData;
      await db.collection('settings').doc('defaultSchedule').set(scheduleData);
    } else {
      // Simpan sebagai jadwal custom untuk user tertentu
      customSchedules[target] = scheduleData;
      await db.collection('userSchedules').doc(target).set(scheduleData);
    }
    
    showToast("Jadwal berhasil diubah", "success");
  } catch (error) {
    console.error("Error mengatur jadwal:", error);
    showToast("Gagal mengatur jadwal", "error");
  }
}

// Sistem OVD - Atur kewajiban presensi
async function setWajibPresensi(status) {
  try {
    await db.collection('settings').doc('wajibPresensi').set({
      status: status,
      diubahOleh: currentUser.uid,
      diubahPada: firebase.firestore.Timestamp.now()
    });
    
    showToast(`Presensi ${status === 'forceOn' ? 'diwajibkan' : 'tidak diwajibkan'}`, "success");
  } catch (error) {
    console.error("Error mengatur kewajiban presensi:", error);
    showToast("Gagal mengatur kewajiban presensi", "error");
  }
}

// Helper functions untuk waktu
function isTimeInRange(time, start, end) {
  return time >= start && time <= end;
}

function isTimeBefore(time, compare) {
  return time < compare;
}

function isTimeAfter(time, compare) {
  return time > compare;
}

function addMinutes(time, minutes) {
  const [hours, mins] = time.split(':').map(Number);
  const date = new Date();
  date.setHours(hours, mins + minutes, 0, 0);
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

// Inisialisasi aplikasi
function initApp() {
  // Periksa status auth
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      currentUser = user;
      
      // Redirect berdasarkan role
      if (ADMIN_UIDS.has(user.uid) && !window.location.pathname.endsWith('admin.html')) {
        window.location.href = 'admin.html';
      } else if (KARYAWAN_UIDS.has(user.uid) && !window.location.pathname.endsWith('karyawan.html')) {
        window.location.href = 'karyawan.html';
      } else if (!ADMIN_UIDS.has(user.uid) && !KARYAWAN_UIDS.has(user.uid)) {
        await auth.signOut();
        window.location.href = 'index.html';
      }
      
      // Load user profile
      await loadUserProfile();
      
      // Load data yang diperlukan berdasarkan halaman
      if (window.location.pathname.endsWith('karyawan.html')) {
        initKaryawanPage();
      } else if (window.location.pathname.endsWith('admin.html')) {
        initAdminPage();
      }
    } else {
      // Redirect ke login jika tidak terautentikasi
      if (!window.location.pathname.endsWith('index.html')) {
        window.location.href = 'index.html';
      }
    }
  });
  
  // Jalankan cleanup notifikasi setiap 7 hari
  setInterval(cleanupOldNotifications, 7 * 24 * 60 * 60 * 1000);
  
  // Update waktu server setiap detik
  setInterval(updateServerTime, 1000);
  updateServerTime();
}

// Load user profile
async function loadUserProfile() {
  try {
    const userDoc = await db.collection('users').doc(currentUser.uid).get();
    
    if (userDoc.exists) {
      const userData = userDoc.data();
      currentUser.displayName = userData.nama;
      currentUser.alamat = userData.alamat;
      currentUser.fotoUrl = userData.fotoUrl;
      
      // Update UI jika elemen tersedia
      const namaElement = $("#nama");
      const alamatElement = $("#alamat");
      const pfpElement = $("#pfp");
      
      if (namaElement) namaElement.value = userData.nama || "";
      if (alamatElement) alamatElement.value = userData.alamat || "";
      if (pfpElement && userData.fotoUrl) pfpElement.src = userData.fotoUrl;
    }
  } catch (error) {
    console.error("Error loading user profile:", error);
  }
}

// Save user profile
async function saveUserProfile(nama, alamat, fotoFile = null) {
  try {
    let fotoUrl = currentUser.fotoUrl;
    
    // Upload foto baru jika ada
    if (fotoFile) {
      const compressedFile = await compressAndStripExif(fotoFile);
      fotoUrl = await uploadToCloudinary(compressedFile);
    }
    
    // Update profile di Firestore
    await db.collection('users').doc(currentUser.uid).set({
      nama: nama,
      alamat: alamat,
      fotoUrl: fotoUrl,
      terakhirDiupdate: firebase.firestore.Timestamp.now()
    }, { merge: true });
    
    // Update local user data
    currentUser.displayName = nama;
    currentUser.alamat = alamat;
    currentUser.fotoUrl = fotoUrl;
    
    showToast("Profil berhasil disimpan", "success");
    return true;
  } catch (error) {
    console.error("Error saving profile:", error);
    showToast("Gagal menyimpan profil", "error");
    return false;
  }
}

// Inisialisasi halaman karyawan
function initKaryawanPage() {
  // Setup event listeners
  $("#snapBtn")?.addEventListener('click', capturePhoto);
  $("#uploadBtn")?.addEventListener('click', () => {
    const jenis = $("#jenis")?.value || "berangkat";
    uploadPresensi(jenis);
  });
  
  $("#cutiFab")?.addEventListener('click', () => {
    $("#cutiDlg").showModal();
  });
  
  $("#ajukanCutiBtn")?.addEventListener('click', () => {
    const jenis = $("#cutiJenis")?.value;
    const tanggal = $("#cutiTanggal")?.value;
    const catatan = $("#cutiCatatan")?.value;
    
    if (!jenis || !tanggal) {
      showToast("Harap isi jenis dan tanggal cuti", "error");
      return;
    }
    
    ajukanCuti(jenis, tanggal, catatan);
  });
  
  $("#profileBtn")?.addEventListener('click', () => {
    $("#profileDlg").showModal();
  });
  
  $("#saveProfileBtn")?.addEventListener('click', async () => {
    const nama = $("#nama")?.value;
    const alamat = $("#alamat")?.value;
    const fotoFile = $("#pfpFile")?.files[0];
    
    if (!nama) {
      showToast("Harap isi nama", "error");
      return;
    }
    
    await saveUserProfile(nama, alamat, fotoFile);
  });
  
  $("#logoutBtn")?.addEventListener('click', () => {
    auth.signOut();
  });
  
  $("#notifBtn")?.addEventListener('click', () => {
    loadNotifications();
    $("#notifDlg").showModal();
  });
  
  // Mulai kamera
  startCamera();
  
  // Dapatkan lokasi
  getCurrentLocation().then(loc => {
    $("#locText").textContent = `${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}`;
  }).catch(err => {
    console.error("Error getting location:", err);
    $("#locText").textContent = "Lokasi tidak diizinkan";
  });
  
  // Load riwayat presensi
  loadRiwayatPresensi();
}

// Inisialisasi halaman admin
function initAdminPage() {
  // Setup event listeners
  $("#exportCsv")?.addEventListener('click', () => {
    const filterNama = $("#fNama")?.value || "";
    const filterWaktu = $("#fTanggal")?.value ? "periode" : "bulanan";
    exportToCSV(filterNama, filterWaktu);
  });
  
  $("#profileBtn")?.addEventListener('click', () => {
    $("#profileDlg").showModal();
  });
  
  $("#saveProfileBtn")?.addEventListener('click', async () => {
    const nama = $("#nama")?.value;
    const alamat = $("#alamat")?.value;
    const fotoFile = $("#pfpFile")?.files[0];
    
    if (!nama) {
      showToast("Harap isi nama", "error");
      return;
    }
    
    await saveUserProfile(nama, alamat, fotoFile);
  });
  
  $("#createUserBtn")?.addEventListener('click', async () => {
    const email = $("#newEmail")?.value;
    const password = $("#newPass")?.value;
    
    if (!email || !password) {
      showToast("Harap isi email dan password", "error");
      return;
    }
    
    try {
      // Buat user baru di Firebase Auth
      const userCredential = await auth.createUserWithEmailAndPassword(email, password);
      const newUser = userCredential.user;
      
      // Simpan data user di Firestore
      await db.collection('users').doc(newUser.uid).set({
        email: email,
        nama: email.split('@')[0], // Default name dari email
        role: "karyawan",
        dibuatPada: firebase.firestore.Timestamp.now()
      });
      
      showToast("Akun berhasil dibuat", "success");
      $("#newEmail").value = "";
      $("#newPass").value = "";
    } catch (error) {
      console.error("Error creating user:", error);
      showToast("Gagal membuat akun", "error");
    }
  });
  
  $("#logoutBtn")?.addEventListener('click', () => {
    auth.signOut();
  });
  
  $("#notifBtn")?.addEventListener('click', () => {
    loadCutiRequests();
    $("#notifDlg").showModal();
  });
  
  $("#sendAnnounce")?.addEventListener('click', () => {
    const isi = $("#announceText")?.value;
    const target = "all"; // Default ke semua karyawan
    
    if (!isi) {
      showToast("Harap isi pengumuman", "error");
      return;
    }
    
    sendPengumuman(isi, target);
  });
  
  $("#saveSchedule")?.addEventListener('click', () => {
    const wajibHari = $("#wajibHari")?.value;
    setWajibPresensi(wajibHari);
  });
  
  // Load data presensi
  loadAllPresensi();
}

// Load riwayat presensi untuk karyawan
async function loadRiwayatPresensi(limit = 20) {
  try {
    const snapshot = await db.collection('presensi')
      .where('uid', '==', currentUser.uid)
      .orderBy('waktu', 'desc')
      .limit(limit)
      .get();
    
    const logList = $("#logList");
    if (!logList) return;
    
    logList.innerHTML = "";
    
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      const waktu = data.waktu.toDate().toLocaleString('id-ID');
      
      const item = document.createElement('div');
      item.className = 'riwayat-item';
      item.innerHTML = `
        <div class="riwayat-jenis">
          <span class="material-symbols-rounded">${data.jenis === 'berangkat' ? 'login' : 'logout'}</span>
          ${data.jenis.toUpperCase()}
          <span class="status ${data.status === 'tepat waktu' ? 's-good' : data.status === 'terlambat' ? 's-warn' : 's-bad'}">
            ${data.status}
          </span>
        </div>
        <div class="riwayat-time">${waktu}</div>
      `;
      
      logList.appendChild(item);
    });
  } catch (error) {
    console.error("Error loading riwayat:", error);
  }
}

// Load semua presensi untuk admin
async function loadAllPresensi(filterNama = "", filterDate = "") {
  try {
    let query = db.collection('presensi').orderBy('waktu', 'desc').limit(100);
    
    // Terapkan filter jika ada
    if (filterNama) {
      // Untuk filter nama, kita perlu mendapatkan UID dari nama
      const usersSnapshot = await db.collection('users')
        .where('nama', '>=', filterNama)
        .where('nama', '<=', filterNama + '\uf8ff')
        .get();
      
      const uids = usersSnapshot.docs.map(doc => doc.id);
      if (uids.length > 0) {
        query = query.where('uid', 'in', uids);
      }
    }
    
    if (filterDate) {
      const date = new Date(filterDate);
      const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
      
      query = query.where('waktu', '>=', firebase.firestore.Timestamp.fromDate(start))
                   .where('waktu', '<', firebase.firestore.Timestamp.fromDate(end));
    }
    
    const snapshot = await query.get();
    const tableBody = $("#tableBody");
    if (!tableBody) return;
    
    tableBody.innerHTML = "";
    
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      const waktu = data.waktu.toDate().toLocaleString('id-ID');
      const koordinat = data.koordinat ? 
        `${data.koordinat.latitude.toFixed(6)}, ${data.koordinat.longitude.toFixed(6)}` : 
        "Tidak ada";
      
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${waktu}</td>
        <td>${data.nama}</td>
        <td>${data.jenis}</td>
        <td><span class="status ${data.status === 'tepat waktu' ? 's-good' : data.status === 'terlambat' ? 's-warn' : 's-bad'}">${data.status}</span></td>
        <td>${koordinat}</td>
        <td>${data.fotoUrl ? `<a href="${data.fotoUrl}" target="_blank">Lihat</a>` : 'Tidak ada'}</td>
      `;
      
      tableBody.appendChild(row);
    });
  } catch (error) {
    console.error("Error loading presensi:", error);
  }
}

// Load notifikasi untuk karyawan
async function loadNotifications() {
  try {
    const snapshot = await db.collection('notifikasi')
      .where('untuk', 'in', [currentUser.uid, 'all'])
      .orderBy('dibuatPada', 'desc')
      .limit(20)
      .get();
    
    const notifList = $("#notifList");
    if (!notifList) return;
    
    notifList.innerHTML = "";
    
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      const waktu = data.dibuatPada.toDate().toLocaleString('id-ID');
      
      const item = document.createElement('div');
      item.className = 'notif-item';
      
      let content = "";
      switch (data.tipe) {
        case 'cuti':
          content = `Pengajuan cuti ${data.data.jenis} pada ${data.data.tanggal.toDate().toLocaleDateString('id-ID')}`;
          break;
        case 'pengumuman':
          content = `Pengumuman: ${data.data.isi}`;
          break;
        case 'override':
          content = `Perubahan jadwal: ${data.data.detail}`;
          break;
        default:
          content = `Notifikasi: ${JSON.stringify(data.data)}`;
      }
      
      item.innerHTML = `
        <div class="notif-content">
          <div>${content}</div>
          <div style="font-size:12px; opacity:0.7">${waktu}</div>
        </div>
        <div class="notif-actions">
          <button class="icon-btn" onclick="markNotifRead('${doc.id}')">
            <span class="material-symbols-rounded">check</span>
          </button>
        </div>
      `;
      
      notifList.appendChild(item);
    });
  } catch (error) {
    console.error("Error loading notifications:", error);
  }
}

// Load permintaan cuti untuk admin
async function loadCutiRequests() {
  try {
    const snapshot = await db.collection('cuti')
      .where('status', '==', 'pending')
      .orderBy('diajukanPada', 'desc')
      .get();
    
    const cutiList = $("#cutiList");
    if (!cutiList) return;
    
    cutiList.innerHTML = "";
    
    snapshot.docs.forEach(doc => {
      const data = doc.data();
      const tanggal = data.tanggal.toDate().toLocaleDateString('id-ID');
      const diajukan = data.diajukanPada.toDate().toLocaleString('id-ID');
      
      const item = document.createElement('div');
      item.className = 'notif-item';
      item.innerHTML = `
        <div class="notif-content">
          <div><strong>${data.nama}</strong> mengajukan cuti ${data.jenis}</div>
          <div>Tanggal: ${tanggal}</div>
          <div>Keterangan: ${data.catatan || "-"}</div>
          <div style="font-size:12px; opacity:0.7">Diajukan: ${diajukan}</div>
        </div>
        <div class="notif-actions">
          <button class="btn" style="background:var(--good)" onclick="approveCuti('${doc.id}', '${data.uid}', '${data.nama}', '${data.jenis}', '${tanggal}')">
            <span class="material-symbols-rounded">check</span>
          </button>
          <button class="btn" style="background:var(--bad)" onclick="rejectCuti('${doc.id}')">
            <span class="material-symbols-rounded">close</span>
          </button>
        </div>
      `;
      
      cutiList.appendChild(item);
    });
  } catch (error) {
    console.error("Error loading cuti requests:", error);
  }
}

// Approve cuti
async function approveCuti(cutiId, uid, nama, jenis, tanggal) {
  try {
    // Update status cuti
    await db.collection('cuti').doc(cutiId).update({
      status: 'approved',
      diprosesPada: firebase.firestore.Timestamp.now(),
      diprosesOleh: currentUser.uid
    });
    
    // Buat presensi cuti
    await createCutiPresensi(uid, nama, jenis, tanggal);
    
    // Kirim notifikasi ke karyawan
    await db.collection('notifikasi').add({
      tipe: 'cuti',
      untuk: uid,
      data: {
        status: 'approved',
        jenis: jenis,
        tanggal: tanggal
      },
      dibaca: false,
      dibuatPada: firebase.firestore.Timestamp.now()
    });
    
    showToast("Cuti disetujui", "success");
    loadCutiRequests();
  } catch (error) {
    console.error("Error approving cuti:", error);
    showToast("Gagal menyetujui cuti", "error");
  }
}

// Reject cuti
async function rejectCuti(cutiId) {
  try {
    // Update status cuti
    await db.collection('cuti').doc(cutiId).update({
      status: 'rejected',
      diprosesPada: firebase.firestore.Timestamp.now(),
      diprosesOleh: currentUser.uid
    });
    
    // Dapatkan data cuti untuk notifikasi
    const cutiDoc = await db.collection('cuti').doc(cutiId).get();
    const cutiData = cutiDoc.data();
    
    // Kirim notifikasi ke karyawan
    await db.collection('notifikasi').add({
      tipe: 'cuti',
      untuk: cutiData.uid,
      data: {
        status: 'rejected',
        jenis: cutiData.jenis,
        tanggal: cutiData.tanggal.toDate().toLocaleDateString('id-ID')
      },
      dibaca: false,
      dibuatPada: firebase.firestore.Timestamp.now()
    });
    
    showToast("Cuti ditolak", "success");
    loadCutiRequests();
  } catch (error) {
    console.error("Error rejecting cuti:", error);
    showToast("Gagal menolak cuti", "error");
  }
}

// Tandai notifikasi sebagai sudah dibaca
async function markNotifRead(notifId) {
  try {
    await db.collection('notifikasi').doc(notifId).update({
      dibaca: true
    });
    
    loadNotifications();
  } catch (error) {
    console.error("Error marking notification as read:", error);
  }
}

// Jalankan inisialisasi aplikasi ketika DOM siap
document.addEventListener('DOMContentLoaded', initApp);