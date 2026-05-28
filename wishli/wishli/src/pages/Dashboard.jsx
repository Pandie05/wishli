import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './Dashboard.css';

const MOCK_ITEMS = [
  { id: 1, name: 'iPhone 15 Pro', price: 45.99, addedBy: 'Judo', wishlist: 'Birthday', color: 'purple' },
  { id: 2, name: 'Rose Gold Watch', price: 45.99, addedBy: 'Judo', wishlist: 'Birthday', color: 'purple' },
  { id: 3, name: 'Marble Surfboard', price: 45.99, addedBy: 'Judo', wishlist: 'Birthday', color: 'pink' },
  { id: 4, name: 'Gaming PC Setup', price: 45.99, addedBy: 'Judo', wishlist: 'Birthday', color: 'purple' },
  { id: 5, name: 'Premium Headset', price: 45.99, addedBy: 'Judo', wishlist: 'Birthday', color: 'pink' },
  { id: 6, name: 'PC Tower', price: 45.99, addedBy: 'Judo', wishlist: 'Birthday', color: 'purple' },
  { id: 7, name: 'Racing Chair', price: 45.99, addedBy: 'Judo', wishlist: 'Birthday', color: 'purple' },
];

const ITEM_COLORS = [
  '#4158D0', '#C850C0', '#0093E9', '#6C2BD9',
  '#EC4899', '#3B82F6', '#8B5CF6'
];

function WishliLogo({ small }) {
  return (
    <div className="sidebar-logo">
      <svg width={small ? 28 : 32} height={small ? 28 : 32} viewBox="0 0 36 36" fill="none">
        <circle cx="18" cy="18" r="18" fill="white" fillOpacity="0.15" />
        <path d="M18 8 L20.5 14.5 L27.5 14.5 L22 18.5 L24 25 L18 21 L12 25 L14 18.5 L8.5 14.5 L15.5 14.5 Z"
          fill="white" stroke="white" strokeWidth="0.5" strokeLinejoin="round" />
      </svg>
      <span className="sidebar-logo-text">Wishli</span>
    </div>
  );
}

function ItemCard({ item, index }) {
  const isPink = index % 3 === 2;
  const bg = ITEM_COLORS[index % ITEM_COLORS.length];
  return (
    <div className="item-card">
      <div className="item-card-header">
        <div className="item-card-meta">
          <div className="item-avatar" style={{ background: bg }} />
          <div className="item-meta-text">
            <span className="item-meta-label">Added by</span>
            <span className="item-meta-value">{item.addedBy}</span>
          </div>
        </div>
        <div className="item-card-meta">
          <div className="item-meta-text" style={{ textAlign: 'right' }}>
            <span className="item-meta-label">Wishlist</span>
            <span className="item-meta-value">{item.wishlist}...</span>
          </div>
          <div className="item-avatar" style={{ background: bg }} />
        </div>
      </div>
      <div className="item-image-wrap">
        <div className="item-image-placeholder" style={{ background: `linear-gradient(135deg, ${bg}22, ${bg}44)` }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={bg} strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        </div>
      </div>
      <p className="item-price">Price: ${item.price.toFixed(2)}</p>
      <button className={`item-buy-btn ${isPink ? 'pink' : 'purple'}`}>
        Go buy this item
      </button>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [activeNav, setActiveNav] = useState('home');
  const progress = 250.01;
  const total = 500;
  const pct = (progress / total) * 100;

  return (
    <div className="dashboard-root">
      <aside className="sidebar">
        <WishliLogo />

        <nav className="sidebar-nav">
          {[
            { id: 'home', label: 'Home', icon: HomeIcon },
            { id: 'wishlists', label: 'Wish lists', icon: ListIcon },
            { id: 'notifications', label: 'Notifications', icon: BellIcon },
            { id: 'settings', label: 'Settings', icon: SettingsIcon },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${activeNav === id ? 'active' : ''}`}
              onClick={() => setActiveNav(id)}
            >
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-actions">
          <button className="nav-item action-item" onClick={() => {}}>
            <PlusIcon />
            <span>Create New List</span>
          </button>
          <button className="nav-item action-item" onClick={() => {}}>
            <CartIcon />
            <span>Add Item</span>
          </button>
        </div>

        <button className="sidebar-account" onClick={() => navigate('/login')}>
          <div className="account-avatar">J</div>
          <span>Account</span>
        </button>
      </aside>

      <main className="dashboard-main">
        <div className="featured-banner">
          <div className="featured-image">
            <div className="featured-image-bg" />
          </div>
          <div className="featured-info">
            <h1 className="featured-title">Christmas</h1>
            <p className="featured-invite">Invite people to collaborate</p>
            <div className="featured-people">
              <p className="featured-people-label">People in list</p>
              <div className="people-avatars">
                <div className="people-avatar" style={{ background: '#6C2BD9' }}>C</div>
                <div className="people-avatar" style={{ background: '#EC4899', marginLeft: -10 }}>H</div>
              </div>
            </div>
            <div className="featured-progress">
              <p className="progress-label">${progress.toFixed(2)} of ${total.toFixed(2)}</p>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${pct}%` }} />
              </div>
            </div>
          </div>
          <div className="featured-decorations">
            <div className="deco deco-1" />
            <div className="deco deco-2" />
            <div className="deco deco-3" />
            <div className="deco deco-4" />
          </div>
        </div>

        <div className="items-grid">
          {MOCK_ITEMS.map((item, i) => (
            <ItemCard key={item.id} item={item} index={i} />
          ))}
        </div>
      </main>
    </div>
  );
}

function HomeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}
function ListIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 01-3.46 0" />
    </svg>
  );
}
function SettingsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
function CartIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6" />
    </svg>
  );
}
