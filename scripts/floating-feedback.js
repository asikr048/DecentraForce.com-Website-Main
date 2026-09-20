/**
 * Floating Feedback System
 * Stores submissions in localStorage key: "userFeedbacks"
 */

const USER_FEEDBACKS_KEY = 'userFeedbacks';
const CONTACT_WHATSAPP_KEY = 'contactWhatsappLink';

/**
 * Get personal WhatsApp contact link from localStorage
 * @returns {string} WhatsApp link or empty string
 */
function getContactWhatsappLink() {
    try {
        const link = localStorage.getItem(CONTACT_WHATSAPP_KEY);
        return link ? link.trim() : '';
    } catch (error) {
        console.error('Error reading contactWhatsappLink from localStorage:', error);
        return '';
    }
}

/**
 * Format any WhatsApp link or phone number into a valid wa.me URL
 * @param {string} input - URL or raw phone number
 * @returns {string} Formatted WhatsApp URL
 */
function formatWhatsAppLink(input) {
    if (!input) return '';
    const trimmed = input.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        return trimmed;
    }
    // Remove all non-digits except a leading plus if present
    const digits = trimmed.replace(/[^\d]/g, '');
    if (digits) {
        return `https://wa.me/${digits}`;
    }
    return trimmed;
}

/**
 * Save personal WhatsApp contact link to localStorage
 * @param {string} link - Link or phone number
 * @returns {boolean} Success status
 */
function saveContactWhatsappLink(link) {
    try {
        const formatted = formatWhatsAppLink(link);
        localStorage.setItem(CONTACT_WHATSAPP_KEY, formatted);
        return true;
    } catch (error) {
        console.error('Error saving contactWhatsappLink to localStorage:', error);
        return false;
    }
}

/**
 * Open the configured personal WhatsApp link in a new tab
 */
function openPersonalWhatsApp() {
    const raw = getContactWhatsappLink();
    const url = formatWhatsAppLink(raw);
    if (!url || url === '#' || url === 'https://wa.me/' || url === 'https://wa.me') {
        showToast('WhatsApp contact link is not configured yet. Please set it in Admin Panel -> Feedback & Contact.', 'error');
        return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
}

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

let feedbackButton, feedbackModal, feedbackForm, feedbackModalClose, feedbackCancel, feedbackToast;
let contactWhatsAppBtn, feedbackModalOpenBtn, modalWhatsAppDirectBtn;

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
    
    contactWhatsAppBtn = document.getElementById('contactWhatsAppBtn');
    feedbackModalOpenBtn = document.getElementById('feedbackModalOpenBtn');
    modalWhatsAppDirectBtn = document.getElementById('modalWhatsAppDirectBtn');

    if (!feedbackButton || !feedbackModal) {
        console.warn('Floating feedback elements not found');
        return;
    }

    // Direct WhatsApp contact click from floating widget
    if (contactWhatsAppBtn) {
        contactWhatsAppBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openPersonalWhatsApp();
        });
    }

    // Direct Feedback modal open from floating widget
    if (feedbackModalOpenBtn) {
        feedbackModalOpenBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openFeedbackModal();
        });
    }

    // Direct WhatsApp contact click inside the modal
    if (modalWhatsAppDirectBtn) {
        modalWhatsAppDirectBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openPersonalWhatsApp();
        });
    }

    // Fallback: If clicking container outside sub-buttons
    feedbackButton.addEventListener('click', (e) => {
        if (e.target.closest('#contactWhatsAppBtn')) return;
        openFeedbackModal();
    });
    
    // Close modal when close button is clicked
    if (feedbackModalClose) feedbackModalClose.addEventListener('click', closeFeedbackModal);
    if (feedbackCancel) feedbackCancel.addEventListener('click', closeFeedbackModal);
    
    // Close modal when clicking outside
    feedbackModal.addEventListener('click', (e) => {
        if (e.target === feedbackModal) {
            closeFeedbackModal();
        }
    });
    
    // Handle form submission
    if (feedbackForm) feedbackForm.addEventListener('submit', handleFeedbackSubmit);
    
    // Close modal with Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && feedbackModal.classList.contains('open')) {
            closeFeedbackModal();
        }
    });
    
    console.log('Floating Contact & Feedback system initialized');
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

// Export functions for use across pages and admin panel
if (typeof window !== 'undefined') {
    window.FloatingFeedback = {
        getAllUserFeedbacks,
        addUserFeedback,
        markFeedbackAsRead,
        deleteUserFeedback,
        getUnreadFeedbackCount,
        getContactWhatsappLink,
        saveContactWhatsappLink,
        formatWhatsAppLink,
        openPersonalWhatsApp,
        openFeedbackModal,
        closeFeedbackModal,
        initFloatingFeedback
    };

    window.getContactWhatsappLink = getContactWhatsappLink;
    window.saveContactWhatsappLink = saveContactWhatsappLink;
    window.formatWhatsAppLink = formatWhatsAppLink;
    window.openPersonalWhatsApp = openPersonalWhatsApp;
    window.openFeedbackModal = openFeedbackModal;
    window.closeFeedbackModal = closeFeedbackModal;
}