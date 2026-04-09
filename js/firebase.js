import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  update,
  onValue,
  get,
  onDisconnect,
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyBMY5kBb_UIV8jpDM2Pj8cm-3aKg78VnC0",
  authDomain: "gamebuzzuer.firebaseapp.com",
  databaseURL:
    "https://gamebuzzuer-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "gamebuzzuer",
  storageBucket: "gamebuzzuer.firebasestorage.app",
  messagingSenderId: "952611711946",
  appId: "1:952611711946:web:881006b2fa17693307bd33",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export { db, ref, set, update, onValue, get, onDisconnect };