# FlatCare 🏠

**Apartment Monthly Maintenance Management System**

A simple, functional Node.js web application for managing apartment maintenance collections, expenses, and financial reports for 30 flats.

## Features

- **Flat Management** – 30 flats with owner details, contact, occupancy status
- **Payment Tracking** – Monthly payment collection with Paid/Pending status
- **Expense Management** – Categorized expense tracking (monthly, six-month, optional)
- **Dashboard** – Financial summary with opening/closing balance, pending amounts
- **Reports** – Monthly financial reports with CSV and PDF export
- **Authentication** – Simple admin login

## Maintenance Rules

| Flat Status | Monthly Charge | Garbage Charge |
|-------------|---------------|----------------|
| Occupied    | ₹1,600        | ₹100 (included)|
| Vacant      | ₹1,500        | ₹0             |

## Tech Stack

- **Backend:** Node.js, Express.js
- **Database:** SQLite (via better-sqlite3)
- **Frontend:** Vanilla HTML, CSS, JavaScript
- **PDF Export:** PDFKit

## Quick Start

### Prerequisites
- Node.js v14+ installed

### Installation

```bash
# Navigate to the project folder
cd "Apartment Maintainance app"

# Install dependencies
npm install

# Start the server
npm start
```

### Access
Open **http://localhost:3000** in your browser.

**Default Credentials:**
- Username: `admin`
- Password: `flatcare123`

### First-Time Setup
1. Login with admin credentials
2. Go to **Flats** → Set owner names, contacts, and occupancy status
3. Go to **Dashboard** → Click "Initialize Month" for the current month
4. Go to **Payments** → Mark payments as received
5. Go to **Expenses** → Add monthly expenses
6. Go to **Reports** → View and export financial reports

## API Endpoints

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/login` | Admin login |
| GET | `/api/logout` | Logout |
| GET | `/api/flats` | List all flats |
| PUT | `/api/flats/:id` | Update flat details |
| POST | `/api/months/initialize?month=&year=` | Initialize month payments |
| GET | `/api/payments?month=&year=` | Get payments for month |
| PUT | `/api/payments/:id/pay` | Mark payment as paid |
| PUT | `/api/payments/:id/unpay` | Undo payment |
| GET | `/api/expenses?month=&year=` | Get expenses for month |
| POST | `/api/expenses` | Add expense |
| DELETE | `/api/expenses/:id` | Delete expense |
| GET | `/api/dashboard?month=&year=` | Dashboard data |
| GET | `/api/reports?month=&year=` | Full report data |
| GET | `/api/reports/csv?month=&year=` | Export CSV |
| GET | `/api/reports/pdf?month=&year=` | Export PDF |

## Folder Structure

```
├── server.js          # Express server & API routes
├── database.js        # SQLite schema & data operations
├── auth.js            # Authentication middleware
├── package.json
├── README.md
├── flatcare.db        # SQLite database (auto-created)
└── public/
    ├── login.html
    ├── dashboard.html
    ├── flats.html
    ├── payments.html
    ├── expenses.html
    ├── reports.html
    ├── css/style.css
    └── js/app.js
```

## Deployment

### Render
1. Push code to GitHub
2. Create a new Web Service on Render
3. Set Build Command: `npm install`
4. Set Start Command: `node server.js`
5. Set Environment Variable: `PORT=3000`

### Railway
1. Push code to GitHub
2. Connect repo on Railway
3. It auto-detects Node.js and deploys

### VPS
```bash
# Clone project
git clone <your-repo-url>
cd <project-folder>

# Install & start
npm install
npm start

# For production, use PM2:
npm install -g pm2
pm2 start server.js --name flatcare
```

## Environment Variables (Optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `ADMIN_USER` | admin | Login username |
| `ADMIN_PASS` | flatcare123 | Login password |
| `SESSION_SECRET` | flatcare-secret-key-2024 | Session encryption key |
