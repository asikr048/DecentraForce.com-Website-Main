/**
 * Feedback/Testimonial System
 * Store in localStorage key: "feedbacks"
 */

const FEEDBACK_STORAGE_KEY = 'feedbacks';
const MENTORS_STORAGE_KEY = 'mentors';
const COURSES_STORAGE_KEY = 'courses';

/* ─── FEEDBACK CRUD ─── */
function getAllFeedbacks() {
    try {
        const stored = localStorage.getItem(FEEDBACK_STORAGE_KEY);
        if (!stored) return [];
        const arr = JSON.parse(stored);
        return arr.sort((a, b) => {
            const sa = (a.sequence_order != null) ? parseInt(a.sequence_order) : 9999;
            const sb = (b.sequence_order != null) ? parseInt(b.sequence_order) : 9999;
            return sa - sb;
        });
    } catch (error) { return []; }
}

function saveFeedbacks(feedbacks) {
    try { localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(feedbacks)); } catch (e) {}
}

function addFeedback(feedback) {
    const feedbacks = getAllFeedbacks();
    const newFeedback = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        name: feedback.name.trim(),
        text: feedback.text.trim(),
        language: feedback.language || 'English',
        rating: feedback.rating || 5,
        role: feedback.role || '',
        imageUrl: feedback.imageUrl || getDefaultAvatar(feedback.name),
        createdAt: feedback.createdAt || new Date().toISOString(),
        sequence_order: feedback.sequence_order != null ? feedback.sequence_order : feedbacks.length
    };
    feedbacks.push(newFeedback);
    saveFeedbacks(feedbacks);
    return newFeedback;
}

function updateFeedback(id, updates) {
    const feedbacks = getAllFeedbacks();
    const index = feedbacks.findIndex(f => f.id == id);
    if (index === -1) return false;
    feedbacks[index] = { ...feedbacks[index], ...updates };
    saveFeedbacks(feedbacks);
    return true;
}

function deleteFeedback(id) {
    const feedbacks = getAllFeedbacks();
    const newFeedbacks = feedbacks.filter(f => f.id != id);
    if (newFeedbacks.length === feedbacks.length) return false;
    saveFeedbacks(newFeedbacks);
    return true;
}

function moveFeedback(id, direction) {
    const feedbacks = getAllFeedbacks();
    const idx = feedbacks.findIndex(f => f.id == id);
    if (idx === -1) return false;
    const swap = direction === 'up' ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= feedbacks.length) return false;
    [feedbacks[idx], feedbacks[swap]] = [feedbacks[swap], feedbacks[idx]];
    feedbacks.forEach((f, i) => { f.sequence_order = i; });
    saveFeedbacks(feedbacks);
    return true;
}

/* ─── HELPERS ─── */
function getDefaultAvatar(name) {
    const initials = (name || 'U').split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
    const colors = ['7b5cff','00e5ff','ff4d8d','00e599','d4af37','ff7b5c','5caaff'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(initials)}&background=${color}&color=fff&size=128&bold=true`;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff/60) + 'm ago';
    if (diff < 86400) return Math.floor(diff/3600) + 'h ago';
    if (diff < 2592000) return Math.floor(diff/86400) + 'd ago';
    return date.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
}

/* ─── RENDER ─── */
function renderFeedbacks(containerSelector, feedbacks) {
    const container = document.querySelector(containerSelector);
    if (!container) return;
    const allFeedbacks = feedbacks || getAllFeedbacks();
    if (allFeedbacks.length === 0) {
        container.innerHTML = '<div class="feedback-empty-state"><div style="font-size:3rem;margin-bottom:16px">💬</div><h3>No feedback yet</h3><p>Be the first to share your experience!</p></div>';
        return;
    }
    container.innerHTML = allFeedbacks.map(function(feedback) {
        const r = feedback.rating || 5;
        const stars = '<span style="color:#fbbf24">' + '★'.repeat(r) + '</span><span style="color:#334">' + '☆'.repeat(5-r) + '</span>';
        const isAdmin = containerSelector.includes('admin') || containerSelector.includes('feedbacksList');
        return '<div class="feedback-card" data-feedback-id="' + feedback.id + '">' +
            '<div class="feedback-quote-mark">"</div>' +
            '<div class="feedback-body-text">' + escapeHtml(feedback.text).replace(/\n/g,'<br>') + '</div>' +
            '<div class="feedback-rating">' + stars + '</div>' +
            '<div class="feedback-author-row">' +
                '<div class="feedback-avatar-img"><img src="' + feedback.imageUrl + '" alt="' + escapeHtml(feedback.name) + '" loading="lazy"></div>' +
                '<div class="feedback-author-info">' +
                    '<h4 class="feedback-author-name">' + escapeHtml(feedback.name) + '</h4>' +
                    '<div class="feedback-author-role">' + escapeHtml(feedback.role || 'Web3 Learner') + '</div>' +
                    '<div class="feedback-meta-row">' +
                        '<span class="lang-badge lang-' + (feedback.language||'english').toLowerCase() + '">' + (feedback.language||'English') + '</span>' +
                        '<span class="feedback-date-text">' + formatDate(feedback.createdAt) + '</span>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            (isAdmin ? '<div class="feedback-admin-btns"><button class="fb-edit-btn" onclick="editFeedback(' + feedback.id + ')">✏️ Edit</button><button class="fb-delete-btn" onclick="deleteFeedbackUI(' + feedback.id + ')">🗑️ Delete</button></div>' : '') +
        '</div>';
    }).join('');
}

/* ─── DEFAULT MOCK DATA ─── */
function initDefaultFeedbacks() {
    const feedbacks = getAllFeedbacks();
    if (feedbacks.length > 0) return;
    const mock = [
        { name:"আহমেদ রহমান", text:"ডিসেন্ট্রাফোর্সের কোর্সগুলো সত্যিই অসাধারণ! ব্লকচেইন বেসিক থেকে স্মার্ট কন্ট্র্যাক্ট পর্যন্ত সব কিছু এত সুন্দরভাবে শেখানো হয়েছে। মাত্র ৩ মাসে আমি একটি ফুল dApp ডিপ্লয় করতে পেরেছি।", language:"Bangla", rating:5, role:"ব্লকচেইন ডেভেলপার", sequence_order:0, createdAt:new Date(Date.now()-2*86400000).toISOString() },
        { name:"Sarah Johnson", text:"This platform completely transformed my career! The Web3 curriculum is world-class and the mentors are incredibly supportive. I landed a job at a crypto startup within 3 months of completing the DeFi course.", language:"English", rating:5, role:"DeFi Protocol Engineer", sequence_order:1, createdAt:new Date(Date.now()-5*86400000).toISOString() },
        { name:"সুমাইয়া আক্তার", text:"বাংলায় ব্লকচেইন শেখার এত ভালো প্ল্যাটফর্ম আর দেখিনি। প্রতিটি কন্সেপ্ট এত সহজভাবে বোঝানো হয়েছে। এখন আমি নিজেই NFT মার্কেটপ্লেস তৈরি করতে পারি।", language:"Bangla", rating:5, role:"NFT আর্টিস্ট ও ডেভেলপার", sequence_order:2, createdAt:new Date(Date.now()-8*86400000).toISOString() },
        { name:"Marcus Williams", text:"The smart contract development course is outstanding. The hands-on projects taught me more in 6 weeks than I learned in a year of self-study. Highly recommend to anyone serious about Web3.", language:"English", rating:5, role:"Smart Contract Auditor", sequence_order:3, createdAt:new Date(Date.now()-12*86400000).toISOString() },
        { name:"রাকিব হাসান", text:"বাংলাদেশ থেকে ব্লকচেইন ডেভেলপার হওয়ার স্বপ্ন পূরণ করেছে ডিসেন্ট্রাফোর্স। মেন্টরদের গাইডেন্সে এখন ইন্টারন্যাশনাল প্রজেক্টে কাজ করছি।", language:"Bangla", rating:5, role:"Web3 ফ্রিল্যান্সার", sequence_order:4, createdAt:new Date(Date.now()-15*86400000).toISOString() },
        { name:"Priya Patel", text:"DecentraForce has the most comprehensive DeFi course I've ever taken. The yield farming strategies they teach are actually used by professionals. My portfolio grew 40% after applying these techniques.", language:"English", rating:5, role:"DeFi Investor & Analyst", sequence_order:5, createdAt:new Date(Date.now()-20*86400000).toISOString() },
        { name:"ফারহানা ইসলাম", text:"স্মার্ট কন্ট্র্যাক্ট কোর্সটি শেষ করার পরে আমার সম্পূর্ণ চিন্তাভাবনা বদলে গেছে। ডিসেন্ট্রালাইজড ফিনান্স সম্পর্কে এখন অনেক পরিষ্কার ধারণা আছে।", language:"Bangla", rating:5, role:"ফিনটেক বিশেষজ্ঞ", sequence_order:6, createdAt:new Date(Date.now()-25*86400000).toISOString() },
        { name:"James Chen", text:"As a traditional finance professional, the transition to Web3 felt daunting. DecentraForce made it seamless. The blockchain fundamentals course bridges traditional finance and DeFi perfectly.", language:"English", rating:5, role:"TradFi to DeFi Specialist", sequence_order:7, createdAt:new Date(Date.now()-30*86400000).toISOString() },
        { name:"তানভীর আলম", text:"Solidity কোর্সটি সত্যিই প্রফেশনাল মানের। রিয়েল-ওয়ার্ল্ড প্রজেক্ট করতে পেরে অনেক কিছু শিখেছি। Ethereum মেইননেটে নিজের কন্ট্র্যাক্ট ডিপ্লয় করতে পারছি।", language:"Bangla", rating:5, role:"Solidity ডেভেলপার", sequence_order:8, createdAt:new Date(Date.now()-35*86400000).toISOString() },
        { name:"Emily Rodriguez", text:"I was a complete beginner in blockchain. Within 4 months of joining DecentraForce, I've built 3 dApps and received two job offers. The community and mentorship here are unmatched.", language:"English", rating:5, role:"Junior Web3 Developer", sequence_order:9, createdAt:new Date(Date.now()-40*86400000).toISOString() },
        { name:"নাজমুল করিম", text:"NFT ও মেটাভার্স কোর্সটি ছিল আমার ক্যারিয়ারের টার্নিং পয়েন্ট। এখন আমি নিজেই আর্ট কালেকশন মিন্ট করি। আয় আগের তুলনায় তিনগুণ বেড়েছে।", language:"Bangla", rating:5, role:"NFT Creator & Trader", sequence_order:10, createdAt:new Date(Date.now()-45*86400000).toISOString() },
        { name:"Sophia Lee", text:"The Web3 full stack course is an absolute gem. Combining React with ethers.js and Hardhat was something I struggled with for months until I took this course. Crystal clear explanations!", language:"English", rating:5, role:"Full Stack Web3 Engineer", sequence_order:11, createdAt:new Date(Date.now()-50*86400000).toISOString() }
    ];
    mock.forEach(function(f) { addFeedback(f); });
}

function initDefaultMentors() {
    try {
        const existing = localStorage.getItem(MENTORS_STORAGE_KEY);
        if (existing && JSON.parse(existing).length > 0) return;
    } catch(e) {}
    const mock = [
        { id:1001, name:"রিফাত করিম", nameEn:"Rifat Karim", title:"Senior Blockchain Architect", bio:"১০+ বছরের অভিজ্ঞতা সহ ব্লকচেইন ও DeFi বিশেষজ্ঞ। Ethereum Foundation কন্ট্রিবিউটর এবং ৫০+ dApp নির্মাণের অভিজ্ঞতাসম্পন্ন।", imageUrl:"https://ui-avatars.com/api/?name=RK&background=7b5cff&color=fff&size=128&bold=true", twitter:"#", linkedin:"#", github:"#", sequence_order:0 },
        { id:1002, name:"সামিরা হোসেন", nameEn:"Samira Hossain", title:"Web3 Frontend Developer", bio:"React ও Solidity বিশেষজ্ঞ। ৫০+ dApp তৈরির অভিজ্ঞতা সহ শীর্ষ DeFi প্রোটোকলে কাজ করেছেন। বাংলাদেশের সেরা মহিলা Web3 ডেভেলপারদের একজন।", imageUrl:"https://ui-avatars.com/api/?name=SH&background=ff4d8d&color=fff&size=128&bold=true", twitter:"#", linkedin:"#", github:"#", sequence_order:1 },
        { id:1003, name:"তানভীর মাহমুদ", nameEn:"Tanvir Mahmud", title:"Smart Contract Security Expert", bio:"Solidity অডিটর হিসেবে ৩০০+ মিলিয়ন ডলারের স্মার্ট কন্ট্র্যাক্ট সিকিউরিটি রিভিউ করেছেন। CertiK ও OpenZeppelin সার্টিফাইড।", imageUrl:"https://ui-avatars.com/api/?name=TM&background=00e599&color=fff&size=128&bold=true", twitter:"#", linkedin:"#", github:"#", sequence_order:2 },
        { id:1004, name:"Alex Rodriguez", nameEn:"Alex Rodriguez", title:"DeFi Protocol Engineer", bio:"Uniswap ও Aave contributor। DeFi yield strategies ও liquidity management বিশেষজ্ঞ। ২০১৭ সাল থেকে ক্রিপ্টো ইন্ডাস্ট্রিতে সক্রিয়।", imageUrl:"https://ui-avatars.com/api/?name=AR&background=fbbf24&color=fff&size=128&bold=true", twitter:"#", linkedin:"#", github:"#", sequence_order:3 },
        { id:1005, name:"নাজমুল হুদা", nameEn:"Nazmul Huda", title:"NFT & Metaverse Strategist", bio:"বাংলাদেশের প্রথম NFT মার্কেটপ্লেস প্রতিষ্ঠাতা। ডিজিটাল আর্ট ও Web3 গেমিং বিশেষজ্ঞ। ৫০০+ আর্টিস্টকে Web3-এ নিয়ে এসেছেন।", imageUrl:"https://ui-avatars.com/api/?name=NH&background=00e5ff&color=fff&size=128&bold=true", twitter:"#", linkedin:"#", github:"#", sequence_order:4 },
        { id:1006, name:"Priya Nair", nameEn:"Priya Nair", title:"Crypto Economics Researcher", bio:"MIT-trained economist specializing in tokenomics, DAO governance, and decentralized finance systems. Published 20+ research papers on blockchain economics.", imageUrl:"https://ui-avatars.com/api/?name=PN&background=ff7b5c&color=fff&size=128&bold=true", twitter:"#", linkedin:"#", github:"#", sequence_order:5 },
        { id:1007, name:"মারিয়া বেগম", nameEn:"Maria Begum", title:"Blockchain Educator & Content Creator", bio:"বাংলায় ব্লকচেইন শিক্ষার পথিকৃৎ। ইউটিউবে ১০০k+ সাবস্ক্রাইবার এবং ৫০০+ বাংলা টিউটোরিয়ালের স্রষ্টা।", imageUrl:"https://ui-avatars.com/api/?name=MB&background=8b5cf6&color=fff&size=128&bold=true", twitter:"#", linkedin:"#", github:"#", sequence_order:6 },
        { id:1008, name:"Daniel Park", nameEn:"Daniel Park", title:"Zero-Knowledge Proof Specialist", bio:"Former Google engineer turned ZK-proof researcher. Contributed to zkSync and StarkWare. Teaches advanced cryptography and Layer-2 scaling solutions.", imageUrl:"https://ui-avatars.com/api/?name=DP&background=0ea5e9&color=fff&size=128&bold=true", twitter:"#", linkedin:"#", github:"#", sequence_order:7 }
    ];
    localStorage.setItem(MENTORS_STORAGE_KEY, JSON.stringify(mock));
}

function initDefaultCourses() {
    try {
        const existing = localStorage.getItem(COURSES_STORAGE_KEY);
        if (existing && JSON.parse(existing).length > 0) return;
    } catch(e) {}
    const mock = [
        { id:2001, title:"Blockchain Fundamentals & Web3 Intro", description:"Grasp the core concepts of distributed ledgers, consensus mechanisms, and the decentralized web. Perfect starting point for beginners.", modules:JSON.stringify({category:"Blockchain",level:"Beginner"}), price:2200, status:"active", rating:4.9, reviews:2100, badge:"🔥 Bestseller", whatsapp:"#", sequence_order:0 },
        { id:2002, title:"Smart Contract Development with Solidity", description:"Write, test, and deploy secure Ethereum smart contracts from scratch to production. Includes real-world auditing techniques.", modules:JSON.stringify({category:"Solidity",level:"Intermediate"}), price:2800, status:"active", rating:4.8, reviews:1600, badge:"⚡ New", whatsapp:"#", sequence_order:1 },
        { id:2003, title:"NFT Creation, Minting & Marketplace", description:"Create and launch your own NFT collection with royalties, metadata, and marketplace listings on OpenSea and beyond.", modules:JSON.stringify({category:"NFT",level:"Beginner"}), price:1800, status:"active", rating:4.7, reviews:980, badge:"🎨 Popular", whatsapp:"#", sequence_order:2 },
        { id:2004, title:"DeFi Protocols & Yield Strategy Mastery", description:"Deep dive into liquidity pools, AMMs, lending protocols, and advanced yield farming. Learn to build on Uniswap, Aave, and Compound.", modules:JSON.stringify({category:"DeFi",level:"Advanced"}), price:3200, status:"active", rating:4.9, reviews:1200, badge:"📈 Trending", whatsapp:"#", sequence_order:3 },
        { id:2005, title:"Web3 Full Stack Development", description:"Build complete dApps with React, ethers.js, and Hardhat. Deploy on mainnet and testnets. Includes job placement support.", modules:JSON.stringify({category:"Web3 Dev",level:"Intermediate"}), price:3500, status:"active", rating:4.8, reviews:890, badge:"⭐ Featured", whatsapp:"#", sequence_order:4 },
        { id:2006, title:"বাংলায় ব্লকচেইন পরিচিতি (Free)", description:"সম্পূর্ণ বাংলায় ব্লকচেইন প্রযুক্তির বেসিক ধারণা। একেবারে নতুনদের জন্য আদর্শ। কোনো পূর্ব অভিজ্ঞতা দরকার নেই।", modules:JSON.stringify({category:"Blockchain",level:"Beginner"}), price:0, status:"active", rating:5.0, reviews:3400, badge:"🆓 Free", whatsapp:"#", sequence_order:5 },
        { id:2007, title:"DAO গভর্ন্যান্স ও টোকেনমিক্স", description:"বাংলায় DAO স্ট্র্যাকচার, ভোটিং মেকানিজম এবং টোকেন ইকোনমি ডিজাইন শিখুন। রিয়েল কেস স্টাডি সহ।", modules:JSON.stringify({category:"DAO",level:"Intermediate"}), price:2500, status:"active", rating:4.7, reviews:620, badge:"🏛️ New", whatsapp:"#", sequence_order:6 },
        { id:2008, title:"Crypto Trading & Technical Analysis", description:"Master chart reading, risk management, and automated trading strategies. From candlestick basics to algorithmic trading bots.", modules:JSON.stringify({category:"Trading",level:"Beginner"}), price:2000, status:"active", rating:4.6, reviews:1450, badge:"💹 Hot", whatsapp:"#", sequence_order:7 }
    ];
    localStorage.setItem(COURSES_STORAGE_KEY, JSON.stringify(mock));
}

function initFeedbackSection() {
    initDefaultFeedbacks();
    initDefaultMentors();
    initDefaultCourses();
    var feedbacks = getAllFeedbacks();
    if (feedbacks.length > 0) {
        renderFeedbacks('#feedback-container', feedbacks);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getAllFeedbacks, addFeedback, updateFeedback, deleteFeedback, moveFeedback, renderFeedbacks, initFeedbackSection, initDefaultFeedbacks, initDefaultMentors, initDefaultCourses };
}
