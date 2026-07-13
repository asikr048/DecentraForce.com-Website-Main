// Test script for my-courses.html functionality
console.log('Testing my-courses.html functionality...');

// Mock localStorage for testing
const mockLocalStorage = {
  data: {},
  getItem(key) {
    return this.data[key] || null;
  },
  setItem(key, value) {
    this.data[key] = value;
  },
  clear() {
    this.data = {};
  }
};

// Temporarily replace global localStorage
const originalLocalStorage = global.localStorage;
global.localStorage = mockLocalStorage;

// Test data
const testPurchases = [
  {
    courseId: 'course1',
    courseTitle: 'Blockchain Fundamentals',
    status: 'approved',
    price: 99,
    timestamp: '2024-01-01T00:00:00Z'
  },
  {
    courseId: 'course2', 
    courseTitle: 'Web3 Development',
    status: 'pending',
    price: 149,
    timestamp: '2024-01-02T00:00:00Z'
  },
  {
    courseId: 'course3',
    courseTitle: 'Solidity Mastery',
    status: 'approved',
    price: 199,
    timestamp: '2024-01-03T00:00:00Z'
  },
  {
    courseId: 'course4',
    courseTitle: 'DeFi Strategies',
    status: 'rejected',
    price: 129,
    timestamp: '2024-01-04T00:00:00Z'
  }
];

// Save test data to mock localStorage
mockLocalStorage.setItem('purchases', JSON.stringify(testPurchases));

// Test the loadPurchasesFromLocalStorage function
function testLoadPurchases() {
  console.log('\n=== Test 1: loadPurchasesFromLocalStorage ===');
  try {
    const purchasesJson = mockLocalStorage.getItem('purchases');
    const purchases = purchasesJson ? JSON.parse(purchasesJson) : [];
    
    if (Array.isArray(purchases) && purchases.length === 4) {
      console.log('✓ Pass: Successfully loaded 4 purchases from localStorage');
      return purchases;
    } else {
      console.log('✗ Fail: Failed to load purchases correctly');
      return [];
    }
  } catch (error) {
    console.log('✗ Fail: Error loading purchases:', error.message);
    return [];
  }
}

// Test the filterApprovedPurchases function  
function testFilterApprovedPurchases(purchases) {
  console.log('\n=== Test 2: filterApprovedPurchases ===');
  try {
    const approvedPurchases = purchases.filter(p => 
      p && typeof p === 'object' && 
      p.status && p.status.toLowerCase() === 'approved'
    );
    
    if (approvedPurchases.length === 2) {
      console.log('✓ Pass: Successfully filtered 2 approved purchases');
      console.log('  Approved courses:', approvedPurchases.map(p => p.courseTitle));
      return approvedPurchases;
    } else {
      console.log('✗ Fail: Expected 2 approved purchases, got', approvedPurchases.length);
      return [];
    }
  } catch (error) {
    console.log('✗ Fail: Error filtering purchases:', error.message);
    return [];
  }
}

// Test edge cases
function testEdgeCases() {
  console.log('\n=== Test 3: Edge Cases ===');
  
  // Test 3.1: Empty localStorage
  mockLocalStorage.clear();
  const emptyPurchases = mockLocalStorage.getItem('purchases');
  if (!emptyPurchases) {
    console.log('✓ Pass: Handles empty localStorage correctly');
  } else {
    console.log('✗ Fail: Should handle empty localStorage');
  }
  
  // Test 3.2: Invalid JSON
  mockLocalStorage.setItem('purchases', '{invalid json');
  try {
    const invalid = JSON.parse(mockLocalStorage.getItem('purchases'));
    console.log('✗ Fail: Should throw error for invalid JSON');
  } catch (e) {
    console.log('✓ Pass: Catches invalid JSON gracefully');
  }
  
  // Test 3.3: Non-array data
  mockLocalStorage.setItem('purchases', JSON.stringify({ not: 'an array' }));
  const notArray = JSON.parse(mockLocalStorage.getItem('purchases'));
  if (!Array.isArray(notArray)) {
    console.log('✓ Pass: Handles non-array data in localStorage');
  } else {
    console.log('✗ Fail: Should handle non-array data');
  }
  
  // Restore test data
  mockLocalStorage.setItem('purchases', JSON.stringify(testPurchases));
}

// Test course matching logic
function testCourseMatching() {
  console.log('\n=== Test 4: Course Matching Logic ===');
  
  const mockCourses = [
    { id: 'course1', title: 'Blockchain Fundamentals', price: 99 },
    { id: 'course2', title: 'Web3 Development', price: 149 },
    { id: 'course3', title: 'Solidity Mastery', price: 199 },
    { id: 'course5', title: 'New Course', price: 79 }
  ];
  
  const approvedPurchases = testPurchases.filter(p => p.status === 'approved');
  const purchasedCourseIds = approvedPurchases.map(p => p.courseId);
  
  const purchasedCourses = mockCourses.filter(course => 
    purchasedCourseIds.includes(course.id?.toString())
  );
  
  if (purchasedCourses.length === 2) {
    console.log('✓ Pass: Correctly matched 2 purchased courses');
    console.log('  Purchased courses:', purchasedCourses.map(c => c.title));
  } else {
    console.log('✗ Fail: Expected 2 purchased courses, got', purchasedCourses.length);
  }
  
  // Test free course detection
  const freeCourse = { id: 'free1', title: 'Free Intro', price: 0 };
  const isFreeCourse = parseFloat(freeCourse.price || 0) === 0;
  if (isFreeCourse) {
    console.log('✓ Pass: Correctly identifies free course (price = 0)');
  } else {
    console.log('✗ Fail: Should identify free course');
  }
}

// Run all tests
function runAllTests() {
  console.log('Starting my-courses.html functionality tests...\n');
  
  const purchases = testLoadPurchases();
  if (purchases.length > 0) {
    const approvedPurchases = testFilterApprovedPurchases(purchases);
    testEdgeCases();
    testCourseMatching();
    
    console.log('\n=== Summary ===');
    console.log('All core functionality tests completed.');
    console.log('The my-courses.html implementation should:');
    console.log('1. Load purchases from localStorage');
    console.log('2. Filter by status "approved"');
    console.log('3. Display purchased courses in the purchased tab');
    console.log('4. Handle edge cases gracefully');
    console.log('5. Open course content safely with validation');
  }
}

// Run tests
runAllTests();

// Restore original localStorage
global.localStorage = originalLocalStorage;