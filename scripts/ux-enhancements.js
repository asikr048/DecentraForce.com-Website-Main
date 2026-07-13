/**
 * UX Enhancements for DecentraForce
 * This script adds loading states, duplicate purchase prevention,
 * toast notifications, and improved mobile UX.
 */

// ==================== TOAST NOTIFICATION SYSTEM ====================

/**
 * Show a toast notification
 * @param {string} message - The message to display
 * @param {string} type - 'success', 'error', or 'info'
 * @param {number} duration - Duration in milliseconds (default: 3000)
 */
function showToast(message, type = 'success', duration = 3000) {
    // Create toast container if it doesn't exist
    let toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        toastContainer.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            gap: 10px;
            max-width: 350px;
        `;
        document.body.appendChild(toastContainer);
    }

    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.style.cssText = `
        background: rgba(13, 22, 48, 0.95);
        color: var(--text, #e8eeff);
        padding: 16px 20px;
        border-radius: 12px;
        border-left: 4px solid ${type === 'success' ? '#00e599' : type === 'error' ? '#ff4d8d' : '#7b5cff'};
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        backdrop-filter: blur(20px);
        transform: translateX(100%);
        opacity: 0;
        transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        font-weight: 500;
        font-size: 0.9rem;
        display: flex;
        align-items: center;
        gap: 10px;
    `;

    // Add icon based on type
    const icon = document.createElement('span');
    icon.textContent = type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ';
    icon.style.cssText = `
        font-size: 1.2rem;
        font-weight: bold;
    `;
    toast.appendChild(icon);

    // Add message
    const messageEl = document.createElement('span');
    messageEl.textContent = message;
    toast.appendChild(messageEl);

    // Add to container
    toastContainer.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
        toast.style.transform = 'translateX(0)';
        toast.style.opacity = '1';
    });

    // Auto-remove after duration
    setTimeout(() => {
        toast.style.transform = 'translateX(100%)';
        toast.style.opacity = '0';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, duration);
}

// ==================== LOADING STATES ====================

/**
 * Show loading state for a button
 * @param {HTMLElement} button - The button element
 * @param {string} loadingText - Text to show while loading (default: 'Loading...')
 */
function showButtonLoading(button, loadingText = 'Loading...') {
    const originalText = button.textContent;
    const originalWidth = button.offsetWidth;
    
    button.innerHTML = `
        <span class="loading-spinner" style="
            display: inline-block;
            width: 16px;
            height: 16px;
            border: 2px solid rgba(255,255,255,0.3);
            border-radius: 50%;
            border-top-color: white;
            animation: spin 1s linear infinite;
            margin-right: 8px;
        "></span>
        ${loadingText}
    `;
    button.style.width = `${originalWidth}px`;
    button.disabled = true;
    
    // Store original content for restoration
    button.dataset.originalText = originalText;
}

/**
 * Hide loading state for a button
 * @param {HTMLElement} button - The button element
 */
function hideButtonLoading(button) {
    const originalText = button.dataset.originalText;
    if (originalText) {
        button.innerHTML = originalText;
    }
    button.style.width = '';
    button.disabled = false;
}

// Add spin animation to global styles
if (!document.querySelector('#loading-styles')) {
    const style = document.createElement('style');
    style.id = 'loading-styles';
    style.textContent = `
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        .loading-spinner {
            display: inline-block;
            width: 16px;
            height: 16px;
            border: 2px solid rgba(255,255,255,0.3);
            border-radius: 50%;
            border-top-color: white;
            animation: spin 1s linear infinite;
        }
    `;
    document.head.appendChild(style);
}

// ==================== DUPLICATE PURCHASE PREVENTION ====================

/**
 * Check if a course has already been purchased
 * @param {string} courseId - The course ID to check
 * @returns {boolean} True if already purchased
 */
function isCoursePurchased(courseId) {
    try {
        const purchases = JSON.parse(localStorage.getItem('purchases') || '[]');
        return purchases.some(purchase => 
            purchase.courseId === courseId && 
            purchase.status === 'approved'
        );
    } catch (error) {
        console.error('Error checking purchase status:', error);
        return false;
    }
}

/**
 * Check if a course purchase is pending
 * @param {string} courseId - The course ID to check
 * @returns {boolean} True if purchase is pending
 */
function isCoursePurchasePending(courseId) {
    try {
        const purchases = JSON.parse(localStorage.getItem('purchases') || '[]');
        return purchases.some(purchase => 
            purchase.courseId === courseId && 
            purchase.status === 'pending'
        );
    } catch (error) {
        console.error('Error checking pending purchase:', error);
        return false;
    }
}

// ==================== ENHANCED CHECKOUT MODAL ====================

/**
 * Initialize enhanced checkout modal
 */
function initEnhancedCheckoutModal() {
    const modalConfirm = document.getElementById('modalConfirm');
    const checkoutModal = document.getElementById('checkoutModal');
    
    if (!modalConfirm || !checkoutModal) return;
    
    // Store current course being purchased
    let currentCourse = null;
    
    // Override the openCheckoutModal function if it exists
    const originalOpenCheckoutModal = window.openCheckoutModal;
    if (typeof originalOpenCheckoutModal === 'function') {
        window.openCheckoutModal = function(course) {
            currentCourse = course;
            
            // Check if already purchased
            if (isCoursePurchased(course.id)) {
                showToast('You already own this course!', 'info');
                return;
            }
            
            // Check if purchase is pending
            if (isCoursePurchasePending(course.id)) {
                showToast('Your purchase is pending approval', 'info');
                return;
            }
            
            // Call original function
            originalOpenCheckoutModal.call(this, course);
            
            // Reset modal button state
            modalConfirm.innerHTML = 'Proceed to Payment';
            modalConfirm.disabled = false;
        };
    }
    
    // Handle purchase confirmation
    modalConfirm.addEventListener('click', async function() {
        if (!currentCourse) return;
        
        // Show loading state
        showButtonLoading(modalConfirm, 'Processing...');
        
        // Simulate API call delay
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        try {
            // Create purchase object
            const purchase = {
                id: Date.now().toString(),
                courseId: currentCourse.id,
                courseTitle: currentCourse.title,
                price: currentCourse.price || 2500,
                status: 'pending',
                createdAt: new Date().toISOString(),
                userId: window.auth?.currentUser?.id || 'anonymous'
            };
            
            // Save to localStorage
            const purchases = JSON.parse(localStorage.getItem('purchases') || '[]');
            purchases.push(purchase);
            localStorage.setItem('purchases', JSON.stringify(purchases));
            
            // Show success message
            showToast('Purchase submitted! Awaiting approval.', 'success');
            
            // Close modal
            const closeCheckoutModal = window.closeCheckoutModal;
            if (typeof closeCheckoutModal === 'function') {
                closeCheckoutModal();
            } else {
                checkoutModal.classList.remove('open');
                document.body.style.overflow = '';
            }
            
            // Update course buttons to show "Pending"
            updateCourseButtons(currentCourse.id, 'pending');
            
        } catch (error) {
            showToast('Purchase failed. Please try again.', 'error');
            console.error('Purchase error:', error);
        } finally {
            // Restore button state
            hideButtonLoading(modalConfirm);
        }
    });
}

/**
 * Update course buttons based on purchase status
 * @param {string} courseId - The course ID
 * @param {string} status - 'purchased', 'pending', or 'available'
 */
function updateCourseButtons(courseId, status) {
    const buttons = document.querySelectorAll(`.buy-now-btn[data-course-id="${courseId}"]`);
    buttons.forEach(button => {
        switch (status) {
            case 'purchased':
                button.textContent = 'Purchased';
                button.className = 'btn btn-disabled';
                button.disabled = true;
                break;
            case 'pending':
                button.textContent = 'Pending Approval';
                button.className = 'btn btn-secondary';
                button.disabled = true;
                break;
            default:
                // Keep original state
                break;
        }
    });
}

// ==================== MOBILE MENU ENHANCEMENT ====================

/**
 * Initialize mobile menu
 */
function initMobileMenu() {
    // Create mobile menu toggle if not exists
    if (!document.querySelector('.mobile-menu-toggle')) {
        const nav = document.querySelector('nav');
        if (!nav) return;
        
        const toggle = document.createElement('button');
        toggle.className = 'mobile-menu-toggle';
        toggle.innerHTML = '☰';
        toggle.style.cssText = `
            display: none;
            background: transparent;
            border: 1px solid var(--border);
            color: var(--text);
            width: 40px;
            height: 40px;
            border-radius: 8px;
            font-size: 1.2rem;
            cursor: pointer;
            margin-left: 10px;
        `;
        
        // Insert toggle button
        const navRight = document.querySelector('.nav-right');
        if (navRight) {
            navRight.insertBefore(toggle, navRight.firstChild);
        }
        
        // Create mobile menu
        const mobileMenu = document.createElement('div');
        mobileMenu.className = 'mobile-menu';
        mobileMenu.style.cssText = `
            display: none;
            position: fixed;
            top: 64px;
            left: 0;
            right: 0;
            background: rgba(5, 10, 24, 0.98);
            backdrop-filter: blur(20px);
            border-bottom: 1px solid var(--border);
            padding: 16px;
            z-index: 98;
            flex-direction: column;
            gap: 4px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.5);
        `;
        
        // Copy nav links to mobile menu
        const navLinks = document.querySelector('.nav-links');
        if (navLinks) {
            const links = navLinks.cloneNode(true);
            links.style.cssText = `
                display: flex;
                flex-direction: column;
                gap: 4px;
                list-style: none;
                padding: 0;
                margin: 0;
            `;
            // Style cloned links
            links.querySelectorAll('a').forEach(a => {
                a.style.cssText = 'display:block;padding:12px 16px;color:var(--muted);text-decoration:none;border-radius:8px;font-size:0.95rem;transition:all 0.2s;';
                a.addEventListener('mouseenter', () => a.style.background = 'rgba(0,229,255,0.07)');
                a.addEventListener('mouseleave', () => a.style.background = '');
            });
            mobileMenu.appendChild(links);
        }

        // Add Login / Register links to mobile menu
        const divider = document.createElement('div');
        divider.style.cssText = 'height:1px;background:var(--border);margin:10px 0;';
        mobileMenu.appendChild(divider);

        const loginLink = document.querySelector('a[data-auth="login"]');
        const registerLink = document.querySelector('a[data-auth="register"]');
        if (loginLink) {
            const a = loginLink.cloneNode(true);
            a.removeAttribute('data-auth');
            a.style.cssText = 'display:block;padding:12px 16px;color:var(--muted);text-decoration:none;border-radius:8px;font-size:0.95rem;border:1px solid var(--border);text-align:center;';
            mobileMenu.appendChild(a);
        }
        if (registerLink) {
            const a = registerLink.cloneNode(true);
            a.removeAttribute('data-auth');
            a.style.cssText = 'display:block;padding:12px 16px;background:linear-gradient(135deg,var(--accent2),var(--accent));color:#fff;text-decoration:none;border-radius:8px;font-size:0.95rem;font-weight:700;text-align:center;margin-top:8px;';
            mobileMenu.appendChild(a);
        }

        document.body.appendChild(mobileMenu);
        
        // Toggle menu
        toggle.addEventListener('click', () => {
            const isOpen = mobileMenu.style.display === 'flex';
            mobileMenu.style.display = isOpen ? 'none' : 'flex';
            toggle.innerHTML = isOpen ? '☰' : '✕';
        });
        
        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
            if (!mobileMenu.contains(e.target) && !toggle.contains(e.target)) {
                mobileMenu.style.display = 'none';
                toggle.innerHTML = '☰';
            }
        });
        
        // Add responsive CSS
        const style = document.createElement('style');
        style.textContent = `
            @media (max-width: 768px) {
                .mobile-menu-toggle {
                    display: block !important;
                }
                .nav-links {
                    display: none !important;
                }
            }
        `;
        document.head.appendChild(style);
    }
}

// ==================== COURSE LOADING STATES ====================

/**
 * Enhance course loading with skeleton screens
 */
function enhanceCourseLoading() {
    // Add skeleton loading to course grids
    const courseGrids = [
        '.courses-grid',
        '#free-courses-grid',
        '#purchased-courses'
    ].filter(selector => document.querySelector(selector));
    
    courseGrids.forEach(selector => {
        const grid = document.querySelector(selector);
        if (!grid) return;
        
        // Check if already has courses
        if (grid.children.length === 0) {
            grid.innerHTML = `
                <div class="course-skeleton" style="
                    background: var(--surface);
                    border-radius: 16px;
                    overflow: hidden;
                    height: 300px;
                    position: relative;
                    overflow: hidden;
                ">
                    <div style="
                        height: 150px;
                        background: linear-gradient(90deg, var(--surface2) 25%, var(--surface) 50%, var(--surface2) 75%);
                        background-size: 200% 100%;
                        animation: loading 1.5s infinite;
                    "></div>
                    <div style="padding: 20px;">
                        <div style="
                            height: 20px;
                            background: var(--surface2);
                            border-radius: 4px;
                            margin-bottom: 10px;
                            width: 60%;
                            animation: loading 1.5s infinite 0.2s;
                        "></div>
                        <div style="
                            height: 16px;
                            background: var(--surface2);
                            border-radius: 4px;
                            margin-bottom: 15px;
                            width: 80%;
                            animation: loading 1.5s infinite 0.4s;
                        "></div>
                        <div style="
                            height: 40px;
                            background: var(--surface2);
                            border-radius: 8px;
                            width: 100%;
                            animation: loading 1.5s infinite 0.6s;
                        "></div>
                    </div>
                </div>
            `.repeat(4);
        }
    });
    
    // Add loading animation
    if (!document.querySelector('#skeleton-animation')) {
        const style = document.createElement('style');
        style.id = 'skeleton-animation';
        style.textContent = `
            @keyframes loading {
                0% { background-position: 200% 0; }
                100% { background-position: -200% 0; }
            }
        `;
        document.head.appendChild(style);
    }
}

// ==================== INITIALIZATION ====================

/**
 * Initialize all UX enhancements
 */
function initUXEnhancements() {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initUXEnhancements);
        return;
    }
    
    // Initialize components
    initEnhancedCheckoutModal();
    initMobileMenu();
    enhanceCourseLoading();
    
    // Make functions available globally
    window.showToast = showToast;
    window.showButtonLoading = showButtonLoading;
    window.hideButtonLoading = hideButtonLoading;
    window.isCoursePurchased = isCoursePurchased;
    
    console.log('UX enhancements initialized');
}

// Start initialization
initUXEnhancements();