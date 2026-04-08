// firebase.js — initialises Firebase once and exports the auth + Firestore services.
// Every page imports from here so there's only ever one Firebase app instance.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getAuth }        from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { getFirestore }   from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyDsSArtuokjcQGitoT7cexHExXycadp_hQ",
  authDomain:        "noorish-1aec1.firebaseapp.com",
  projectId:         "noorish-1aec1",
  storageBucket:     "noorish-1aec1.firebasestorage.app",
  messagingSenderId: "1070738689928",
  appId:             "1:1070738689928:web:bdee91d4516031175ff43d"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);
