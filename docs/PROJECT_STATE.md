# Memory Cue — Project State

## Overview
Memory Cue is an AI-assisted “second brain” system that allows users to:
- Store notes and reminders quickly
- Retrieve them using natural language
- Surface relevant memories contextually
- Eventually use AI for semantic recall and reasoning

---

## ✅ Current Working State

### Authentication
- Firebase Authentication (Google) is configured and working
- Auth state is being detected correctly
- User ID is available globally:
  window.__MEMORY_CUE_AUTH_USER_ID

---

### Storage / Data Layer
- Firestore is now the **primary database**
- Reminders are successfully:
  - Loaded from Firestore
  - Synced locally
  - Migrated from local storage

Console confirmation:

```text
[brain] reminders migrated to firebase
[brain] reminders_loaded_from_firestore {count: 70}
```

- Local storage still exists as fallback layer

---

### Reminder System
- reminderController is active
- reminderStore is loading correctly
- Reminders are:
  - Retrieved
  - Stored
  - Synced

Previously blocking issue:
- compareRemindersForDisplay → ✅ FIXED

---

### UI State
- App loads successfully
- Reminders display without crashing
- No major blocking UI errors

---

### Hosting / Deployment
- Hosted on Cloudflare Pages
- Build system functioning
- App loads in browser environment

---

## ⚠️ Known Issues (Non-blocking)

### Background Sync

Periodic background sync unavailable  
NotAllowedError: Permission denied

- Caused by browser permissions / service worker limits
- Not critical for core functionality

---

### Geolocation

GeolocationPositionError: Timeout expired

- Affects weather feature only
- Not core to app

---

### Supabase

[supabase] env not set — running local only

- Supabase is no longer in active use
- Safe to remove in future cleanup

---

- AI assistant reasoning

---

## 🧠 Current Architecture

### Flow

User → UI  
→ reminderController  
→ memoryService  
→ Firestore (primary storage)

Optional (not active yet):  
→ embeddingService (OpenAI)

---

## 📦 Data Model (Observed)

Reminders include:
- dueAt (Firestore)
- timestamp (local fallback)
- priority (optional)

System supports:
- local + cloud compatibility

---

## 🔧 Recently Completed

- Firebase Authentication integration
- Firestore connection established
- Reminder migration to Firestore
- Reminder sync working
- compareRemindersForDisplay bug fixed
- App stable with real data

---

## 🚧 Next Priorities

### 1. Enable AI Layer (HIGH PRIORITY)
- Add OpenAI API key
- Activate embeddingService
- Store embeddings for memories
- Enable semantic search

---

### 2. Build Query Understanding
Examples to support:
- “What did I write about football training?”
- “Show reminders for today”
- “What did I add yesterday?”

---

### 3. Clean Architecture
- Remove Supabase completely
- Centralise config
- Standardise data schema

---

### 4. Improve UX
- Better reminder sorting/display
- Loading states
- Empty states

---

### 5. Background Processing (Later)
- Revisit background sync
- Notifications
- Scheduled reminders

---

## 🚨 Critical Notes

- Firebase is now the **single source of truth**
- AI system is scaffolded but inactive
- App is currently a **working reminder system (non-AI)**

---

## 🧭 Current Phase

🟢 Phase 1 COMPLETE: Core App + Firebase  
🟡 Phase 2 NEXT: AI Activation  
⚪ Phase 3 FUTURE: “Second Brain” Intelligence
