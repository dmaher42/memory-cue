/* firebase-init.js */
const firebaseConfig = {
  // TODO: replace with your Firebase project configuration
};

if (!firebase.apps.length) {
  try {
    firebase.initializeApp(firebaseConfig);
  } catch (err) {
    console.warn('Firebase init error', err);
  }
}
