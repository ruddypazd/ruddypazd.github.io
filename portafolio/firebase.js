
  // Import the functions you need from the SDKs you need
  import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
  import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-analytics.js";
  // TODO: Add SDKs for Firebase products that you want to use
  // https://firebase.google.com/docs/web/setup#available-libraries

  // Your web app's Firebase configuration
  // For Firebase JS SDK v7.20.0 and later, measurementId is optional
  const firebaseConfig = {
    apiKey: "AIzaSyBiv7cC-hFDt83Jo8RX8Kz0XSSLCfRnBQo",
    authDomain: "ruddypazd-b6514.firebaseapp.com",
    projectId: "ruddypazd-b6514",
    storageBucket: "ruddypazd-b6514.firebasestorage.app",
    messagingSenderId: "498044837919",
    appId: "1:498044837919:web:c14061b0743498a671f52a",
    measurementId: "G-2652ZHLB4R"
  };

  // Initialize Firebase
  const app = initializeApp(firebaseConfig);
  const analytics = getAnalytics(app);