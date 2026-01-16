# 🗓️ MOHMD — Whiteout Survival Pack Calendar

**Real-Date Pack Schedule & Purchase Tracking Tool**  
Never miss a pack. Never double-buy. Always reset-aware.

---

Built for serious players who want **clarity** on *when packs appear*, *how long they last*, and *when they reset* — all aligned to **00:00 UTC**.

---

![version](https://img.shields.io/badge/version-v1.0.0-00ffbf?style=for-the-badge)
![focus](https://img.shields.io/badge/focus-Pack%20Calendar-00b7ff?style=for-the-badge)
![timezone](https://img.shields.io/badge/reset-00:00%20UTC-ffffff?style=for-the-badge)
![language](https://img.shields.io/badge/language-EN-8a2be2?style=for-the-badge)

---

##  English

### 📌 Overview

**MOHMD — Whiteout Survival Pack Calendar** is a web-based calendar that tracks **weekly, monthly, and event-based packs** using **real-world dates**.

Unlike guesswork spreadsheets or Discord reminders, this tool:
- Uses **true UTC reset logic**
- Shows **active pack windows**
- Tracks **purchase limits**
- Tells you **exactly when you can buy again**

Built to support whales, PvP players, and organized alliances.

---

### ✨ Key Features

| Feature | Description |
|------|------------|
| 🗓️ Real-Date Calendar | Monthly & weekly views using real calendar dates |
| ⏰ UTC Reset Logic | All packs reset at **00:00 UTC** (no timezone confusion) |
| 🔁 Weekly Windows | Supports packs active **Mon → next Mon** |
| 🛒 Purchase Tracking | Mark packs as bought and lock until next reset |
| 🚫 Double-Buy Protection | Instantly see if a pack is already capped |
| 📦 Detailed Pack Info | Name, description, contents, price, limits |
| 🧠 State Day Mapping | Converts real dates to **State Day (UTC)** |

---

### 🧭 How It Works

1. Set **State Start Date** or enter **“Today is State Day X”**
2. Calendar maps every real date → correct **State Day**
3. Packs appear only during their valid window
4. Buy a pack → it locks until the correct reset
5. After reset → pack becomes available again automatically

No manual tracking. No mistakes.

---

### 📁 Project Structure

```text
/
├─ index.html        # Calendar UI
├─ styles.css        # Dark UI theme
├─ app.js            # Calendar + reset + purchase logic
└─ data/
   └─ packs.json     # All pack definitions & rules
