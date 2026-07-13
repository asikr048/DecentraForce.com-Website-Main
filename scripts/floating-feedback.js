/**
 * Floating Feedback System
 * Stores submissions in localStorage key: "userFeedbacks"
 */

const USER_FEEDBACKS_KEY = 'userFeedbacks';

/**
 * Get all user feedbacks from localStorage
 * @returns {Array} Array of feedback objects
 */
function getAllUserFeedbacks() {
    try {
        const stored = localStorage.getItem(USER_FEEDBACKS_KEY);
        if (!stored) return [];
        return JSON.parse(stored);
    } catch (error) {
        console.error('Error reading userFeedbacks from localStorage:', error);
        return [];
    }
}

/**
 * Save feedbacks to localStorage
 * @param {Array} feedbacks - Array of feedback objects
 */
function saveUserFeedbacks(feedbacks) {
    try {
        localStorage.setItem(USER_FEEDBACKS_KEY, JSON.stringify(feedbacks));
    } catch (error) {
        console.error('Error saving userFeedbacks to localStorage:', error);
    }
}

/**
 * Add a new user feedback
 * @param {Object} feedback - Feedback object with name, contact, message
 * @returns {Object} The added feedback with generated id and timestamp
 */
function addUserFeedback(feedback) {
    const feedbacks = getAllUserFeedbacks();
    const newFeedback = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        name: feedback.name ? feedback.name.trim() : 'Anonymous',
        contact: feedback.contact ? feedback.contact.trim() : '',
        message: feedback.message.trim(),
        createdAt: new Date().toISOString(),
        read: false
    };
    feedbacks.unshift(newFeedback); // Add to beginning for newest first
    saveUserFeedbacks(feedbacks);
    return newFeedback;
}

/**
 * Mark feedback as read
 * @param {number} id - Feedback ID
 * @returns {boolean} Success status
 */
function markFeedbackAsRead(id) {
    const feedbacks = getAllUserFeedbacks();
    const index = feedbacks.findIndex(f => f.id == id);
    if (index === -1) return false;
    
    feedbacks[index].read = true;
    saveUserFeedbacks(feedbacks);
    return true;
}

/**
 * Delete a feedback by ID
 * @param {number} id - Feedback ID
 * @returns {boolean} Success status
 */
function deleteUserFeedback(id) {
    const feedbacks = getAllUserFeedbacks();
    const newFeedbacks = feedbacks.filter(f => f.id != id);
    if (newFeedbacks.length === feedbacks.length) return false;
    saveUserFeedbacks(newFeedbacks);
    return true;
}

/**
 * Get unread feedback count
 * @returns {number} Count of unread feedbacks
 */
function getUnreadFeedbackCount() {
    const feedbacks = getAllUserFeedbacks();
    return feedbacks.filter(f => !f.read).length;
}

// DOM Elements
let feedbackButton, feedbackModal, feedbackForm, feedbackModalClose, feedbackCancel, feedbackToast;

/**
 * Initialize the floating feedback system
 */
function initFloatingFeedback() {
    // Get DOM elements
    feedbackButton = document.getElementById('feedbackButton');
    feedbackModal = document.getElementById('feedbackModal');
    feedbackForm = document.getElementById('feedbackForm');
    feedbackModalClose = document.getElementById('feedbackModalClose');
    feedbackCancel = document.getElementById('feedbackCancel');
    feedbackToast = document.getElementById('feedbackToast');
    
    if (!feedbackButton || !feedbackModal) {
        console.warn('Floating feedback elements not found');
        return;
    }
    
    // Open modal when button is clicked
    feedbackButton.addEventListener('click', openFeedbackModal);
    
    // Close modal when close button is clicked
    feedbackModalClose.addEventListener('click', closeFeedbackModal);
    feedbackCancel.addEventListener('click', closeFeedbackModal);
    
    // Close modal when clicking outside
    feedbackModal.addEventListener('click', (e) => {
        if (e.target === feedbackModal) {
            closeFeedbackModal();
        }
    });
    
    // Handle form submission
    feedbackForm.addEventListener('submit', handleFeedbackSubmit);
    
    // Close modal with Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && feedbackModal.classList.contains('open')) {
            closeFeedbackModal();
        }
    });
    
    console.log('Floating feedback system initialized');
}

/**
 * Open the feedback modal
 */
function openFeedbackModal() {
    feedbackModal.classList.add('open');
    document.body.style.overflow = 'hidden'; // Prevent scrolling
    
    // Clear form fields
    document.getElementById('feedbackName').value = '';
    document.getElementById('feedbackContact').value = '';
    document.getElementById('feedbackMessage').value = '';
    
    // Focus on message field
    setTimeout(() => {
        document.getElementById('feedbackMessage').focus();
    }, 100);
}

/**
 * Close the feedback modal
 */
function closeFeedbackModal() {
    feedbackModal.classList.remove('open');
    document.body.style.overflow = '';
}

/**
 * Handle feedback form submission
 * @param {Event} e - Form submit event
 */
function handleFeedbackSubmit(e) {
    e.preventDefault();
    
    const name = document.getElementById('feedbackName').value;
    const contact = document.getElementById('feedbackContact').value;
    const message = document.getElementById('feedbackMessage').value;
    
    // Validate required message
    if (!message.trim()) {
        showToast('Please enter a feedback message', 'error');
        document.getElementById('feedbackMessage').focus();
        return;
    }
    
    // Create feedback object
    const feedback = {
        name,
        contact,
        message
    };
    
    // Add to localStorage
    const savedFeedback = addUserFeedback(feedback);
    
    // Show success message with enhanced animation
    showToast('Thank you! Your feedback has been submitted.', 'success');
    
    // Add visual feedback to submit button
    const submitBtn = document.querySelector('.feedback-btn-primary');
    if (submitBtn) {
        submitBtn.innerHTML = '<span class="btn-loading"><span class="success-check">✓</span> Submitted!</span>';
        submitBtn.style.background = 'linear-gradient(90deg, #00e599, #00cc88)';
        submitBtn.disabled = true;
        submitBtn.style.transform = 'translateY(-3px) scale(1.05)';
        submitBtn.style.boxShadow = '0 8px 30px rgba(0, 229, 153, 0.4), 0 0 0 2px rgba(0, 229, 153, 0.2)';
        
        // Reset button after delay
        setTimeout(() => {
            submitBtn.innerHTML = 'Submit Feedback';
            submitBtn.style.background = '';
            submitBtn.style.transform = '';
            submitBtn.style.boxShadow = '';
            submitBtn.disabled = false;
        }, 2000);
    }
    
    // Close modal with smooth animation after delay
    setTimeout(() => {
        closeFeedbackModal();
    }, 1800);
    
    // Log for debugging
    console.log('Feedback submitted:', savedFeedback);
}

/**
 * Show toast notification
 * @param {string} message - Toast message
 * @param {string} type - Toast type (success, error)
 */
function showToast(message, type = 'success') {
    if (!feedbackToast) return;
    
    const toastMessage = document.getElementById('feedbackToastMessage');
    if (toastMessage) {
        toastMessage.textContent = message;
    }
    
    // Set type class
    feedbackToast.className = 'feedback-toast';
    feedbackToast.classList.add(type);
    
    // Show toast
    feedbackToast.classList.add('show');
    
    // Hide after 3 seconds
    setTimeout(() => {
        feedbackToast.classList.remove('show');
    }, 3000);
}

/**
 * Check if we should show the feedback button on this page
 * Some pages might not need it (like admin)
 */
function shouldShowFeedbackButton() {
    const path = window.location.pathname;
    const excludedPages = ['admin.html', 'login.html', 'register.html'];
    return !excludedPages.some(page => path.includes(page));
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    if (shouldShowFeedbackButton()) {
        // Small delay to ensure all DOM elements are fully rendered
        setTimeout(initFloatingFeedback, 100);
    }
});

// Export functions for use in admin panel
if (typeof window !== 'undefined') {
    window.FloatingFeedback = {
        getAllUserFeedbacks,
        addUserFeedback,
        markFeedbackAsRead,
        deleteUserFeedback,
        getUnreadFeedbackCount,
        initFloatingFeedback
    };
}