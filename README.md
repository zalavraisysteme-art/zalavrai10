# 🏆 ZALAVRAI SYSTÈME — v10.0

> **PWA de gestion commerciale** · 4 rôles · 21 panels · Supabase · Cartes clients HD · Mode offline

---

## 📁 Fichiers à uploader sur GitHub (9 fichiers)

```
index.html      ← Application complète PWA
sw.js           ← Service Worker offline v13
manifest.json   ← Déclaration PWA
icon-192.png    ← Icône Android
icon-512.png    ← Icône HD
icon-180.png    ← Icône iPhone
schema.sql      ← Tables Supabase (SQL à exécuter)
Code.gs         ← Backend GAS (optionnel/legacy)
README.md       ← Ce fichier
```

---

## 🚀 DÉPLOIEMENT — GitHub Pages + Supabase

### ÉTAPE 1 — GitHub (5 min)

1. **github.com** → **New repository**
2. Nom : `zalavrai-systeme` · Visibilité : **Public** · Create
3. Cliquer **"uploading an existing file"**
4. Glisser les **9 fichiers** → **Commit changes**
5. **Settings** → **Pages** → Source : **Deploy from a branch**
6. Branch : **main** · Folder : **/ (root)** → **Save**
7. Attendre 2 min → URL : `https://TON_USERNAME.github.io/zalavrai-systeme/`

### ÉTAPE 2 — Supabase (7 min)

1. **supabase.com** → New Project → nommer `zalavrai`
2. **SQL Editor** → New Query → coller tout `schema.sql` → **Run ▶**
3. **Storage** → New bucket → nom `zalavrai-photos` → **Public ON** → Create
4. **Settings → API** → copier **Project URL** + **anon public key**

### ÉTAPE 3 — Connexion (2 min)

1. Ouvrir l'app GitHub Pages
2. Login : `admin` / `admin123`
3. ⚙️ **Réglages** → **☁️ Connexion Supabase**
4. Coller **URL** + **clé anon** → **Connecter Supabase**
5. ✅ Statut vert → synchronisation active

---

## 🔐 Connexion par défaut

```
Username : admin
Password : admin123
```
⚠️ Changer ce mot de passe dès la première connexion !

---

## 📱 Installer comme app (PWA)

**Android** : Chrome → Menu ⋮ → "Ajouter à l'écran d'accueil"

**iPhone** : Safari → Partager → "Sur l'écran d'accueil"

---

*ZALAVRAI SYSTÈME · GitHub Pages + Supabase · 100% Gratuit*
