/**
 * Simplified version of the logic in memory-search.js for testing
 */
function simpleSimilarity(a, b) {
  if (!a || !b) return 0;
  const wordsA = a.toLowerCase().split(/\W+/).filter(Boolean);
  const wordsB = b.toLowerCase().split(/\W+/).filter(Boolean);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;
  const setB = new Set(wordsB);
  let score = 0;
  const uniqueWordsA = new Set(wordsA);
  for (const word of uniqueWordsA) {
    if (setB.has(word)) {
      score++;
    }
  }
  return score;
}

function runTests() {
  const tests = [
    { a: "apple banana", b: "apple cherry", expected: 1 },
    { a: "Project Athens status", b: "Athens project notes", expected: 2 },
    { a: "grocery list", b: "buy milk and eggs", expected: 0 },
    { a: "buy milk", b: "shopping list: milk, eggs", expected: 1 },
    { a: "", b: "something", expected: 0 },
    { a: "Hello World", b: "hello world!", expected: 2 },
  ];

  console.log("Running Similarity Tests:");
  tests.forEach((t, i) => {
    const actual = simpleSimilarity(t.a, t.b);
    const passed = actual === t.expected;
    console.log(`Test ${i + 1}: ${passed ? "PASSED" : "FAILED"} (expected ${t.expected}, got ${actual}) [a: "${t.a}", b: "${t.b}"]`);
  });
}

runTests();
