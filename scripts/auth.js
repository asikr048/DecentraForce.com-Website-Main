/**
 * Authentication utilities for DecentraForce
 * This script handles automatic login, session verification, and user state management
 */

class AuthManager {
  constructor() {
    this.currentUser = null;
    this.isLoggedIn = false;
    this.init();
  }

  async init() {
    // Check if user is already logged in on page load
    await this.checkSession();
    
    // Update UI based on login state
    this.updateUI();
  }

  /**
   * Check if user has a valid session
   */
  async checkSession() {
    try {
      const response = await fetch('/api/auth/verify', {
        method: 'GET',
        credentials: 'include'
      });
      
      // Handle non-JSON responses
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        throw new Error(`Invalid response: ${text}`);
      }
      
      const data = await response.json();
      
      if (response.ok && data.success && data.loggedIn) {
        this.currentUser = data.user;
        this.isLoggedIn = true;
        console.log('User is logged in:', this.currentUser.username);
        return true;
      }
      
      // Handle specific error cases
      if (response.status === 401) {
        console.log('Session expired or invalid');
      } else {
        console.error('Session verification failed:', data.error);
      }
    } catch (error) {
      console.error('Session check failed:', error);
    }
    
    this.currentUser = null;
    this.isLoggedIn = false;
    return false;
  }

  /**
   * Update UI elements based on login state
   */
  updateUI() {
    // Get all auth-related elements once
    const authElements = {
      login: document.querySelectorAll('[data-auth="login"]'),
      logout: document.querySelectorAll('[data-auth="logout"]'),
      user: document.querySelectorAll('[data-auth="user"]'),
      protected: document.querySelectorAll('[data-auth="protected"]'),
      register: document.querySelectorAll('[data-auth="register"]')
    };

    // Toggle visibility based on login state
    const toggleVisibility = (elements, show) => {
      elements.forEach(el => {
        el.style.display = show ? 'block' : 'none';
      });
    };

    if (this.isLoggedIn) {
      // User is logged in
      toggleVisibility(authElements.login, false);
      toggleVisibility(authElements.logout, true);
      toggleVisibility(authElements.register, false);
      
      // Update user display elements
      authElements.user.forEach(el => {
        if (el.dataset.field === 'username') {
          el.textContent = this.currentUser.username;
        } else if (el.dataset.field === 'email') {
          el.textContent = this.currentUser.email;
        } else {
          el.textContent = this.currentUser.username;
        }
        el.style.display = 'inline-block';
      });

      // Show protected elements
      toggleVisibility(authElements.protected, true);

      // Update avatar initials (2 letters)
      const avatarEl = document.getElementById('navAvatarText');
      if (avatarEl && this.currentUser && this.currentUser.username) {
        const parts = this.currentUser.username.trim().split(/\s+/);
        const initials = parts.length >= 2
          ? (parts[0][0] + parts[1][0]).toUpperCase()
          : this.currentUser.username.substring(0, 2).toUpperCase();
        avatarEl.textContent = initials;
      }

      // Show/hide admin-only elements
      const adminEls = document.querySelectorAll('.admin-only');
      const isAdmin = this.currentUser && this.currentUser.isAdmin;
      adminEls.forEach(el => {
        if (isAdmin) {
          el.classList.add('show');
          el.style.removeProperty('display');
        } else {
          el.classList.remove('show');
        }
      });
    } else {
      // User is not logged in
      toggleVisibility(authElements.login, true);
      toggleVisibility(authElements.logout, false);
      toggleVisibility(authElements.register, true);
      
      // Hide user display elements
      toggleVisibility(authElements.user, false);
      
      // Hide protected elements
      toggleVisibility(authElements.protected, false);

      // Always hide admin-only when logged out
      document.querySelectorAll('.admin-only').forEach(el => {
        el.classList.remove('show');
      });
    }
  }

  /**
   * Login with email or username
   */
  async login(identifier, password) {
    try {
      // Validate inputs
      if (!identifier || !password) {
        return { success: false, error: 'Identifier and password are required' };
      }
      
      // Determine if identifier is email or username
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const isEmail = emailRegex.test(identifier);
      
      const requestBody = isEmail ? { email: identifier, password } : { username: identifier, password };
      
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        credentials: 'include'
      });
      
      // Handle non-JSON responses
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        throw new Error(`Invalid response: ${text}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        this.currentUser = data.user;
        this.isLoggedIn = true;
        this.updateUI();
        return { success: true, user: data.user };
      } else {
        return { success: false, error: data.error || 'Login failed' };
      }
    } catch (error) {
      console.error('Login error:', error);
      return {
        success: false,
        error: error.message || 'Network error'
      };
    }
  }

  /**
   * Logout current user
   */
  async logout() {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
      
      this.currentUser = null;
      this.isLoggedIn = false;
      
      // Clear legacy local storage purchases so they don't leak to anonymous sessions
      localStorage.removeItem('purchases'); 
      
      this.updateUI();
      
      return { success: true };
    } catch (error) {
      console.error('Logout error:', error);
      return { success: false, error: 'Logout failed' };
    }
  }

  /**
   * Register new user
   */
  async register(username, email, password) {
    try {
      // Validate inputs
      if (!username || !email || !password) {
        return { success: false, error: 'All fields are required' };
      }
      
      if (password.length < 8) {
        return { success: false, error: 'Password must be at least 8 characters' };
      }
      
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, email, password })
      });
      
      // Handle non-JSON responses
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        throw new Error(`Invalid response: ${text}`);
      }
      
      const data = await response.json();
      
      if (data.success) {
        return { success: true, user: data.user };
      } else {
        return { success: false, error: data.error || 'Registration failed' };
      }
    } catch (error) {
      console.error('Registration error:', error);
      return {
        success: false,
        error: error.message || 'Network error'
      };
    }
  }

  /**
   * Request a password reset PIN (Triggers backend EmailJS)
   */
  async forgotPassword(email) {
    try {
      if (!email) {
        return { success: false, error: 'Email is required' };
      }

      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email })
      });

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        throw new Error(`Invalid response: ${text}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Forgot password error:', error);
      return { success: false, error: error.message || 'Network error' };
    }
  }

  /**
   * Reset password using PIN
   */
  async resetPassword(email, pin, newPassword) {
    try {
      if (!email || !pin || !newPassword) {
        return { success: false, error: 'Email, PIN, and new password are required' };
      }

      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, pin, newPassword })
      });

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        throw new Error(`Invalid response: ${text}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Reset password error:', error);
      return { success: false, error: error.message || 'Network error' };
    }
  }

  /**
   * Get current user info
   */
  getUser() {
    return this.currentUser;
  }

  /**
   * Check if user is logged in
   */
  getIsLoggedIn() {
    return this.isLoggedIn;
  }
}

// Create global auth instance
window.auth = new AuthManager();

// Auto-initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  // If auth wasn't already initialized, initialize it
  if (!window.auth) {
    window.auth = new AuthManager();
  }
});

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AuthManager;
}