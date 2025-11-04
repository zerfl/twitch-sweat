# Baseline Metrics

**Captured:** 2025-11-04
**Purpose:** Establish baseline for measuring modularization progress

---

## Code Quality Metrics

### Lines of Code

| Metric | Value |
|--------|-------|
| **Total source lines** | 2,009 |
| **Total test lines** | 917 |
| **Largest file (index.ts)** | 1,002 lines |
| **Test-to-code ratio** | 45.6% |

### File Size Distribution (Source Files)

| File | Lines | Status |
|------|-------|--------|
| src/index.ts | 1,002 | ❌ TOO LARGE |
| src/constants/prompts.ts | ~200 | ⚠️ ACCEPTABLE |
| src/utils/OpenAIManager.ts | 97 | ✅ GOOD |
| src/utils/helpers.ts | 101 | ✅ GOOD |
| src/managers/ThemeManager.ts | 53 | ✅ GOOD |
| src/managers/IgnoreListManager.ts | ~60 | ✅ GOOD |
| src/managers/MeaningManager.ts | ~60 | ✅ GOOD |
| src/managers/BannedGifterManager.ts | ~80 | ✅ GOOD |
| src/managers/ImageDataStore.ts | ~100 | ✅ GOOD |
| src/utils/CloudflareUploader.ts | ~100 | ✅ GOOD |
| src/utils/CooldownManager.ts | ~80 | ✅ GOOD |

**Key Issues:**
- index.ts contains 50% of total source code (1,002 / 2,009 = 49.9%)
- index.ts has multiple responsibilities (bot setup, events, commands, orchestration)

---

## Test Coverage

### Current Test Suite

| Metric | Value |
|--------|-------|
| **Total tests** | 33 |
| **Test files** | 4 |
| **Passing tests** | 33 (100%) |
| **Test execution time** | ~33ms |

### Test Breakdown

**Unit Tests:**
- CooldownManager: 3 tests
- IgnoreListManager: 3 tests
- Utility Helpers: 16 tests
  - isAdminOrBroadcaster: 5 tests
  - truncate: 5 tests
  - exists: 3 tests
  - ensureFileExists: 3 tests

**Integration Tests:**
- ImageGeneration: 11 tests (placeholders for future)

### Coverage Estimate

Based on existing tests and code analysis:
- **Estimated coverage:** ~15-20%
- **Tested modules:** CooldownManager, IgnoreListManager, helpers
- **Untested modules:** index.ts main logic, managers (Theme, Meaning, BannedGifter, ImageDataStore), OpenAIManager, CloudflareUploader

---

## Complexity Metrics

### Cyclomatic Complexity (Estimated)

| Module | Complexity | Notes |
|--------|------------|-------|
| index.ts | Very High | ~20 commands + ~10 event handlers + initialization |
| generateImage() | High | ~10 decision points |
| handleEventAndSendImageMessage() | Medium | ~5 decision points |
| Managers | Low | Simple CRUD operations |
| Utilities | Low | Mostly pure functions |

### Module Coupling

**Current State:** High coupling
- All managers instantiated globally
- Commands directly access global variables
- No dependency injection
- Hard to test in isolation

---

## Performance Metrics

### Estimated (Based on Code Analysis)

These metrics will be measured in Phase 1 completion:

| Metric | Estimated Value | Measurement Method |
|--------|----------------|-------------------|
| Image generation time | 5-15 seconds | Mock OpenAI in tests |
| Command response time | <100ms | Measure in tests |
| Memory usage | 150-300 MB | Monitor during runtime |
| Startup time | <5 seconds | Measure app initialization |

**Note:** These are estimates. Actual measurements will be taken in subsequent phases.

---

## Technical Debt

### Critical Issues

1. **Monolithic index.ts** (1,002 lines)
   - Contains bot initialization, event handlers, command definitions
   - Violates Single Responsibility Principle
   - Difficult to test, understand, and maintain

2. **JSON-based storage**
   - ImageDataStore has TODO: "seriously inefficient"
   - No transactions or data integrity
   - File I/O on every operation
   - Poor scalability

3. **Tight coupling**
   - Global state management
   - No dependency injection
   - Hard to swap implementations

4. **Limited testing**
   - Only ~15-20% coverage
   - No integration tests for main flows
   - No mocking of external services

### Medium Priority Issues

1. **Commented-out code**
   - Button interactions in Discord handler
   - Unused features not fully implemented

2. **Inconsistent error handling**
   - Generic try-catch blocks
   - Console.log for errors
   - No structured logging

3. **Missing documentation**
   - No inline JSDoc comments
   - No README for development
   - No architecture documentation

---

## Dependencies

### Production Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| @twurple/api | ^7.2.1 | Twitch API |
| @twurple/auth | ^7.2.1 | Twitch authentication |
| @twurple/easy-bot | ^7.2.1 | Twitch bot framework |
| discord.js | ^14.14.1 | Discord bot |
| openai | ^4.94.0 | OpenAI API client |
| axios | ^1.6.7 | HTTP requests |
| dotenv | ^16.3.1 | Environment variables |
| joi | ^17.13.3 | Schema validation |
| zod | ^3.23.8 | TypeScript validation |
| nanoid | ^5.0.4 | ID generation |
| throttled-queue | ^2.1.4 | Rate limiting |

**Total:** 11 production dependencies

### Development Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| typescript | ^5.3.3 | TypeScript compiler |
| tsx | ^4.6.2 | TypeScript execution |
| mocha | ^10.2.0 | Test framework |
| chai | ^4.3.10 | Assertions |
| sinon | ^18.0.1 | Mocking (newly added) |
| eslint | ^9.17.0 | Linting |
| prettier | ^3.1.1 | Formatting |

**Total:** 7+ development dependencies

---

## Security

### Vulnerabilities (from npm audit)

**As of 2025-11-04:**
- 10 vulnerabilities total
  - 1 critical
  - 1 high
  - 5 moderate
  - 3 low

**Recommended action:** Run `npm audit fix` after modularization is complete to avoid breaking changes during refactoring.

---

## Module Dependencies Graph

### Current Module Dependencies

```
index.ts (Main Entry)
├─→ env.ts
├─→ constants/
│   ├─→ config.ts
│   ├─→ prompts.ts
│   └─→ styles.ts
├─→ schemas/
│   └─→ imageSchemas.ts
├─→ managers/
│   ├─→ ThemeManager.ts
│   ├─→ MeaningManager.ts
│   ├─→ IgnoreListManager.ts
│   ├─→ BannedGifterManager.ts
│   └─→ ImageDataStore.ts
├─→ utils/
│   ├─→ OpenAIManager.ts
│   ├─→ CloudflareUploader.ts
│   ├─→ CooldownManager.ts (unused in index.ts)
│   └─→ helpers.ts
└─→ External packages (twurple, discord.js, openai, etc.)
```

**Observations:**
- Flat dependency structure (good)
- All modules imported into index.ts (bad for separation)
- No circular dependencies (good)
- CooldownManager not used in main app (technical debt)

---

## Target Metrics (Post-Modularization)

### Code Quality Targets

| Metric | Baseline | Target | Improvement |
|--------|----------|--------|-------------|
| Largest file | 1,002 lines | <300 lines | 70% reduction |
| Test coverage | ~15% | >80% | 433% increase |
| Total tests | 33 | >150 | 354% increase |
| Cyclomatic complexity (index.ts) | Very High | N/A (eliminated) | 100% reduction |
| Module coupling | High | Low | Decoupled via DI |

### Performance Targets

| Metric | Baseline | Target | Tolerance |
|--------|----------|--------|-----------|
| Image generation time | 5-15s | ±5% | Acceptable |
| Command response time | <100ms | <100ms | Maintain |
| Memory usage | 150-300 MB | ±10% | Acceptable |
| Startup time | <5s | <5s | Maintain |
| Test execution time | 33ms | <500ms | Acceptable |

---

## Progress Tracking

**Phase 1 Status:** IN PROGRESS

### Completed Tasks (Phase 1)
- ✅ Install sinon for mocking
- ✅ Create test helpers (MockOpenAI, MockTwitchBot, MockDiscordBot, TestData)
- ✅ Write unit tests for helpers.ts (16 tests added)
- ✅ Create integration test placeholders (11 tests)
- ✅ Document behavior specification
- ✅ Establish baseline metrics

### Remaining Tasks (Phase 1)
- ⏳ Set up CI/CD pipeline
- ⏳ Final Phase 1 review and commit

---

*This baseline will be used to measure progress and ensure modularization improves the codebase without degrading performance or functionality.*
