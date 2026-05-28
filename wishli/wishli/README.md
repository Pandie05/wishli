# Wishli

A collaborative wishlist web application that allows users to create multiple wishlists, add items, track prices, and share lists with others for group planning and gift coordination.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React, React Router |
| Backend | Node.js, Express |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Hosting | AWS Amplify |

## Team

- Christopher Southey
- Hendry
- Jayden

## Getting Started

### Prerequisites

- Node.js v18+
- npm v9+

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/[your-org]/wishli.git
   cd wishli
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm start
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Deployment

This app is deployed via **AWS Amplify** with continuous deployment connected to the `main` branch on GitHub. Any push to `main` triggers an automatic rebuild and redeploy.

**Live URL:** `https://main.[app-id].amplifyapp.com`

## Project Structure

```
wishli/
  public/
    index.html
  src/
    pages/
      Login.jsx       # Login screen
      Login.css
      Dashboard.jsx   # Main dashboard
      Dashboard.css
    App.jsx           # Routing
    index.js          # Entry point
    index.css         # Global styles
  package.json
  README.md
```

## Features (Current Prototype)

- Login screen with email/password form
- Dashboard with featured wishlist banner
- Item grid with mock wishlist items
- Sidebar navigation

## Planned Features

- User registration and authentication via Supabase
- Create and manage multiple wishlists
- Add, edit, and delete items
- Item details (name, price, description, URL, image, quantity, notes)
- Auto-calculated total cost per wishlist
- Wishlist sharing and collaboration
- Reserved/purchased item tracking
- Real-time updates
- Notifications
- Dark/light mode
