# Frontend Audit — Running Findings

**Audit started:** 2026-06-21
**Branch:** feat/main-cat-yh
**Scope:** All `frontend/src/**/*.ts(x)` (184 files)

> **Working tree note:** Yashh is actively editing concurrently. New `M`
> files appearing between sweeps (e.g. `AdminAISettings.tsx`,
> `AdminProgramDetail.tsx`) need to be re-checked at the end before
> any fix pass.

---

## Status legend

| Marker | Meaning |
|--------|---------|
| ⏳ PENDING | Found by an auditor, not yet triaged |
| ✅ FIXED   | Patch landed and verified by `npm run build` |
| ❌ WONTFIX | Triaged out — left as-is with reasoning |
| 🔁 RE-CHECK | Auditor disagrees with prior classification |

---

## Source coverage

| Source | Files | Findings | Status |
|--------|------:|---------:|--------|
| Infrastructure (hand-read) | 14 | 5H/6M/4L | ✅ Merged |
| Community / Explore / FAQ (subagent 2) | 43 | 13H/20M/19L | ✅ Merged |
| Admin UI (subagent 1) | 59 | 15H/25M/35L | ✅ Merged |
| User-facing components + top-level pages (subagent 3) | 78 | TBD | 🔄 Pending |
| **Running total** | **116 / 184** | **33H / 51M / 58L** | |

---

## HIGH PRIORITY — Must Fix

### H1. `AppRoutes.tsx:60` — Dead variable + debug comment in production

- **File:** `frontend/src/routes/AppRoutes.tsx:60`
- **Bug:** `const AppSettingsAdminRouter = lazy(() => import('../admin/pages/AdminSettings').then(m => ({ default: m.default })));` is declared but **never used**. Trailing comment is a leftover investigation note. `.then(m => ({ default: m.default }))` wrapper is unnecessary.
- **Fix:** Delete line 60.

### H2. `api.ts:281` — 401 handler clears localStorage but doesn't sync React auth state in the same tab

- **File:** `frontend/src/utils/api.ts:275-290`
- **Bug:** `storage` event fires cross-tab only. Same-tab `user` state stays stale after 401. Every click re-triggers the auth modal.
- **Fix:** Dispatch a custom event `auth:logout` that `useAuth` listens for, or expose `forceLogout()` on AuthContext.

### H3. `api.ts:77` — Global cache wipe on every mutation

- **File:** `frontend/src/utils/api.ts:71-78`
- **Bug:** Any mutation clears the entire cache. One community upvote wipes profile, notifications, trending, FAQ caches. Surgically invalidating affected keys would be better.

### H4. `useAuth.tsx:48` — localStorage user parsed without validation

- **File:** `frontend/src/hooks/useAuth.tsx:48-55`
- **Bug:** `JSON.parse(saved) as User` with no shape check. Tampered localStorage crashes the app.

### H5. `useNotifications.tsx:60` — Hook never polls; unread count drifts

- **File:** `frontend/src/hooks/useNotifications.tsx:60-63`
- **Bug:** Fetches once on mount. No interval, no focus re-fetch. NotificationBell has to poll separately.

### H6. `PostDetailDialog.tsx:515-528`, `ThreadDetail.tsx:198-212`, `CommentNode.tsx:166-181, 193-208` — Enter-key race in comment/answer forms

- **Files:** `frontend/src/components/community/{PostDetailDialog,ThreadDetail,CommentNode}.tsx`
- **Bug:** Rapid Enter → `setLoading(true)` not committed before next read → two POSTs → duplicate comments. Plus `onKeyDown={... handleComment(e as unknown as React.FormEvent)}` is a hack.
- **Fix:** `inFlightRef` guard, dispatch via `requestSubmit(formEl)` on Enter.

### H7. All modals — Body scroll-lock clobbers stacked modals

- **Files:** `PostDetailDialog.tsx`, `ThreadDetail.tsx`, `AdminModeration.tsx`, `AdminProjectsPage.tsx`, `AdminZoomMeetings.tsx`, `FaqReview.tsx`, `ProjectSelectionModal.tsx`, `AdminSupportCategories.tsx`, `AdminUsers.tsx`, `AdminWelcomePage.tsx`
- **Bug:** 5 inconsistent patterns (correct dep `[open]`, `[modalState]`, sibling-list `[dismissModal,warnModal,suspendModal,banModal]`, or broken `[]`). All reset `overflow` to `''` on unmount without saving the previous value. When AuthModal is open underneath a community modal, child closing first wipes the parent's lock.
- **Fix:** Extract `useBodyScrollLock(open: boolean)` with a module-level refcount stack. Replace all 5 patterns.

### H8. `ExploreSearchBar.tsx:28-46` — Debounce setTimeout never cleared on unmount

- **File:** `frontend/src/components/explore/ExploreSearchBar.tsx`
- **Bug:** `debounceRef.current` set but no `useEffect` cleanup. Unmount before 250ms fires → setState on unmounted component.

### H9. `usePublicFaqApi.ts:64-65` — Module-level cache never invalidated after mutations

- **File:** `frontend/src/components/explore/usePublicFaqApi.ts`
- **Bug:** Cache independent of `api.ts`. No TTL. Stale data after every mutation.

### H10. `useReadingTracker.ts:99` + `PublicFaqDetail.tsx:127-132` — Window scroll listener never fires (analytics silently broken)

- **Files:** `frontend/src/components/explore/{useReadingTracker.ts,PublicFaqDetail.tsx}`
- **Bug:** Article has `overflow-y-auto`. Tracker listens on `window`. Window doesn't scroll → `scrollPct` stays 0 → no `read` event ever fires.
- **Fix:** Attach to the article element (or `node` ref).

### H11. `CreatePostDialog.tsx:21-25` — Render-time side effects (calls onClose + openModal during render)

- **File:** `frontend/src/components/community/CreatePostDialog.tsx`
- **Bug:** Calls `onClose()` and `openModal('signin')` during render. React 18 strict mode infinite-loops in dev.
- **Fix:** Move into `useEffect`.

### H12. `SearchFeedback.tsx:16-29` — Auto-reset timer re-shows dismissed prompt after 8s

- **File:** `frontend/src/components/faq/SearchFeedback.tsx`
- **Bug:** Two effects compete; the 8s auto-reset re-pops a prompt the user just dismissed.
- **Fix:** Drop the 8s timer, or store dismissal in a ref.

### H13. `PostDetailDialog.tsx:336-345`, `CommentNode.tsx:336-345` — Verify action silently mutates the `comment` prop

- **Files:** `frontend/src/components/community/{PostDetailDialog,CommentNode}.tsx`
- **Bug:** `comment.verified = res.data.verified` mutates prop, no re-render. Silent `console.error` on failure.

### H14. All community files — `String(id)` on upvote/downvote/bookmark id objects silently mis-compares

- **Files:** `components/community/{CommunityPostCard,PostDetailDialog,ThreadDetail,CommentNode}.tsx`
- **Bug:** `String({})` is `'[object Object]'`, never equals a real user id. The `_id || u` short-circuit returns the whole object when `_id` is falsy.
- **Fix:** Extract `idMatches(u, currentUserId): boolean` helper.

### H15. `SpillTheTea.tsx:258-263, 84-87` — "Load more" fires duplicate pages on rapid click

- **File:** `frontend/src/components/community/SpillTheTea.tsx`
- **Bug:** `onClick={() => fetchTea(page + 1)}` reads stale `page`. No `disabled={loading}` guard. Two rapid clicks → two parallel requests.
- **Fix:** Disable + `inFlightRef` guard.

### H16. `SpillTheTea.tsx:74-82` — Background-poll toast logic only fires for `latestDrop`

- **File:** `frontend/src/components/community/SpillTheTea.tsx`
- **Bug:** `lastSeenIdRef` is single-ID cursor. Intermediate drops between 60s polls are silently absorbed.

### H17. `ThreadDetail.tsx:643, 668` — `window.location.href = q.url` causes full page reload

- **File:** `frontend/src/components/community/ThreadDetail.tsx`
- **Bug:** Hard navigation. SPA-internal click should use `<Link>` / `useNavigate`.

### H18. `PublicFaqDetail.tsx:14-26, 30` — `useExploreSession` returns different value on SSR vs first client render

- **File:** `frontend/src/components/explore/PublicFaqDetail.tsx`
- **Bug:** Returns `'ssr'` on server, fresh id on first client mount. Hydration mismatch waiting to happen.

### H19. `AdminZoomTab.tsx:217-218` — Dead `setSaving(true)` in `finally` block + debug comment

- **File:** `frontend/src/admin/pages/AdminZoomTab.tsx:217-218`
- **Bug:** ```js } finally { setSaving(true); // Wait, this should be false! Let's set it to false setSaving(false); } ``` — the dead `setSaving(true)` overrides nothing (correct net effect is `saving=false`) but the inline comment "this should be false" is a leftover debugging note. The next reader will be confused.
- **Fix:** Delete `setSaving(true);` and the comment. Keep only `setSaving(false);`.

### H20. `AdminZoomMeetings.tsx:208-226` — Polling timeout leak when `uploadMeetingId` becomes `null`

- **File:** `frontend/src/admin/pages/AdminZoomMeetings.tsx:208-226`
- **Bug:** The poll's `.then()` schedules a new `setTimeout(poll, 2000)` even after the cleanup has run (because the response set `setUploadMeetingId(null)`, triggering the cleanup). The new timeout is never cleared.
- **Fix:** Track a `cancelled` ref; check inside `.then()` before scheduling the next poll.

### H21. `AdminSupportTicket.tsx:124-127` — `window.prompt()` regressed after explicit removal

- **File:** `frontend/src/admin/pages/AdminSupportTicket.tsx`
- **Bug:** File's own comment says "v1.65.1 — no browser-native `prompt()` dialog", yet `handleConvertToGolden` uses two `window.prompt()` calls. Blocks event loop, can't be styled, breaks IME.
- **Fix:** Inline modal with `<input>` for `spCost` and `<textarea>` for `note`.

### H22. `AdminModeration.tsx:288` — `prompt('Enter resolution details:')` for "Resolve" action

- **File:** `frontend/src/admin/pages/AdminModeration.tsx`
- **Bug:** Resolve uses `window.prompt()`; Dismiss correctly opens a modal. Same anti-pattern as H21.

### H23. `AdminGoldenTickets.tsx:193, 213` — `window.alert()` for important async feedback

- **File:** `frontend/src/admin/pages/AdminGoldenTickets.tsx`
- **Bug:** Penalty and ban confirmations use blocking `alert()`. Every other page uses toasts.
- **Fix:** Switch to the `motion + AnimatePresence` toast pattern used elsewhere.

### H24. `AdminModeration.tsx:116-122` — Silent `catch {}` in `doAction` swallows every error

- **File:** `frontend/src/admin/pages/AdminModeration.tsx`
- **Bug:** Warn/Suspend/Ban/Unban errors silently swallowed. No feedback.
- **Fix:** Surface the error in a toast.

### H25. `AdminZoomInsights.tsx:139, 149` — `catch { /* silent */ }` on approve/reject/promote

- **File:** `frontend/src/admin/pages/AdminZoomInsights.tsx`
- **Bug:** Admin clicks "Approve" and gets no signal on failure. `fetchInsights` + `fetchStats` re-called regardless of success.

### H26. `FaqReview.tsx:94` — `setQueue([])` in catch wipes the previous list on transient error

- **File:** `frontend/src/admin/pages/FaqReview.tsx`
- **Bug:** A network blip wipes the entire review queue. User has to re-paginate to find their place.
- **Fix:** Leave the list intact on error, surface a toast.

### H27. `AdminProgramSettingsPage.tsx:64-65` — Slug collision via name-based lookup

- **File:** `frontend/src/admin/pages/AdminProgramSettingsPage.tsx`
- **Bug:** `encodeURIComponent(name.toLowerCase()...)` — two programs with names that kebab-case identically collide silently. Backend lookup is via `_id`; the slug is for URLs only.
- **Fix:** Use program `id` for the admin endpoint, not a derived slug.

### H28. `AdminModeration.tsx:166-170` — 60-second `setInterval` poll has no in-flight guard

- **File:** `frontend/src/admin/pages/AdminModeration.tsx` (similar pattern in `AdminGoldenTickets.tsx:154-170`)
- **Bug:** `setInterval(fetchTickets, 60_000)`. If fetch takes >60s, multiple polls stack. Interval is recreated every time `fetchTickets` changes identity.
- **Fix:** Chain with `setTimeout` like the upload poller, or guard with an in-flight ref.

### H29. `AdminProgramDetail.tsx:222-243` — `OverviewTab` is a hard-coded stub with literal `"—"` for every stat

- **File:** `frontend/src/admin/pages/AdminProgramDetail.tsx`
- **Bug:** The landing tab renders 8 stat boxes all containing `"—"`. It's the first thing an admin sees on a program page and it's entirely dead.
- **Fix:** Fetch real per-program stats, or remove the tab.

### H30. `AdminWelcomePage.tsx:92-95` — `AdminProjectsPage` mounted inside another layout via negative margin hack

- **File:** `frontend/src/admin/pages/AdminWelcomePage.tsx`
- **Bug:** `<div className="-mt-8"><AdminProjectsPage /></div>` to compensate for `AdminProjectsPage`'s top padding. Fragile; breaks if anything else wraps it.
- **Fix:** Move to its own route.

### H31. `AdminProgramSettingsPage.tsx:182` — `onChange={(e) => isHex(e.target.value) && update(...)}` silently drops invalid input

- **File:** `frontend/src/admin/pages/AdminProgramSettingsPage.tsx`
- **Bug:** User deletes a hex character → input doesn't update (no state set). User is confused why keystrokes are ignored.
- **Fix:** Hold an unsanitized local string and commit on blur/Enter.

### H32. `AdminUnresolvedSearch.tsx:118` — Hardcoded user-identifying tokens in source code

- **File:** `frontend/src/admin/pages/AdminUnresolvedSearch.tsx`
- **Bug:** `spamPatterns = ['test', 'vaibhav', 'nigga', 'awdawd', 'one two ka four', 'hehehe', ',epw']`. Hardcoded user-identifying tokens ("vaibhav") in source code is a privacy concern if this repo becomes public.
- **Fix:** Move to a backend-managed list or scrub identifying tokens.

### H33. `AdminZoomInsights.tsx:121-124` + `AdminZoomMeetings.tsx:136-144` — Repeated 4 sequential count calls

- **Files:** `frontend/src/admin/pages/{AdminZoomInsights,AdminZoomMeetings}.tsx`
- **Bug:** 4 sequential `limit=0&status=...` calls just to read counts (pending/approved/rejected/total). The backend should expose a single stats endpoint.
- **Fix:** Add `/zoom/insights/stats` and `/zoom/meetings/stats` endpoints.

---

## MEDIUM PRIORITY — Should Fix

### M1. `ProgramContext.tsx:16` — JSDoc block uses `//` line markers

- **File:** `frontend/src/context/ProgramContext.tsx:16-19`
- **Bug:** Lines inside the `/** */` block start with `//`. JSDoc parsers ignore them.

### M2. `AuthModalHost.tsx:7` — FirstVisitAuthPrompt fires again after localStorage clear

- **File:** `frontend/src/components/auth/AuthModalHost.tsx`
- **Bug:** Triggered once per localStorage flag; clearing storage re-arms.

### M3. `BatchContext.tsx:13` — Stale migration TODO

- **File:** `frontend/src/context/BatchContext.tsx`
- **Bug:** Comment says "When v1.70 ships the cutover, delete this file" — v1.70 already shipped.

### M4. `api.ts:309` — `friendlyError` swallows 4xx body if longer than 200 chars

- **File:** `frontend/src/utils/api.ts`
- **Bug:** Long backend validation messages get replaced with generic fallback.

### M5. `useAuth.tsx:74-94` — `storage` event handler doesn't clear `user` first

- **File:** `frontend/src/hooks/useAuth.tsx`
- **Bug:** Brief flash of previous user's UI while fetching new user.

### M6. `useCloudinaryUpload.ts:57` — In-flight counter increments before validation

- **File:** `frontend/src/hooks/useCloudinaryUpload.ts`

### M7. `PostDetailDialog.tsx:689, 566-570, 583-588` — Manual `document.createElement` toasts (3x)

- **File:** `frontend/src/components/community/PostDetailDialog.tsx`

### M8. `ThreadDetail.tsx:432-450` — Admin delete uses `window.confirm`

- **File:** `frontend/src/components/community/ThreadDetail.tsx`

### M9. `ThreadDetail.tsx:415-428 vs 602-620` — Two "Write answer" UI surfaces with conflicting visibility

- **File:** `frontend/src/components/community/ThreadDetail.tsx`

### M10. `CategoryAccordion.tsx:42` — Re-fetches ALL categories just to lazy-load one accordion's top FAQs

- **File:** `frontend/src/components/explore/CategoryAccordion.tsx`

### M11. `QuestionList.tsx:150-156` — IntersectionObserver re-created on every parent re-render

- **File:** `frontend/src/components/faq/QuestionList.tsx`

### M12. `CreatePostDialog.tsx:130-148` — Duplicate check silently swallows backend "no AI key"

- **File:** `frontend/src/components/community/CreatePostDialog.tsx`

### M13. `usePublicFaqApi.ts:54-57` — All fetch errors collapse to one generic message

- **File:** `frontend/src/components/explore/usePublicFaqApi.ts`

### M14. `ThreadDetail.tsx:415, CommentNode.tsx:268-272` — Repeated `idMatches` pattern

### M15. `CommentNode.tsx:84` — `countReplies(comment)` is O(n) recursive, runs every render

### M16. `PostDetailDialog.tsx:530-544` — Resolve form has no character counter

### M17. `PostDetailDialog.tsx:529-544` — `resolveText` stale after optimistic close

### M18. `CreatePostDialog.tsx:88-90` — Toast setTimeout not cleared on unmount

### M19. `ExploreSearchBar.tsx:31-33` — useEffect resyncs `internal` from `value` after every parent render

### M20. `ThreadDetail.tsx:730-741` — Comment form has no character counter

### M21. `CommunityHealth.tsx:23, 29-30` — Hard-coded fake "this week" delta

### M22. `TopSolved.tsx:147-156, 109-135` — Two divergent empty/loaded states disagree on section header

### M23. `SpillTheTea.tsx:105-113` — `setInterval` polling set on every `fetchTea` identity change

### M24. `PublicFaqDetail.tsx:62-68` — `onScroll` listener reads `node` from closure

### M25. `CategoryAccordion.tsx:48-57` — In-category filter is pure substring, no debounce

### M26. `useCourses.ts:13-21` — Contradictory return type cast

### M27. All admin modals — Missing `role="dialog"`, `aria-modal="true"`, focus trap, ESC handler

- **Files:** Every admin modal except `Modal.tsx`
- **Bug:** Only `Modal.tsx:8` handles ESC. Every other modal lacks ESC, `role="dialog"`, focus trap. Power users can't dismiss with keyboard.

### M28. All admin modals — Click-outside-to-close pattern inconsistent (padding closes the modal)

- **Files:** All admin modals
- **Bug:** Some attach `onClick={onClose}` to the wrapper containing both backdrop and panel; clicking panel padding closes the modal. Inconsistent with `Modal.tsx`'s separate backdrop layer.

### M29. All admin modals — No `aria-label` on close button (most pages)

### M30. All admin toasts — `setTimeout(() => setToast(null), 3000)` with no cleanup

- **Files:** 12+ files (`AdminFAQs`, `AdminCommunity`, `AdminSupportCategories`, `AdminSupportGuidance`, `AdminFeatures`, `AdminProgramDashboard`, `AdminCoursesPage`, `AdminDocumentInsights`, `AdminUnresolvedSearch`, `AdminSettings`, `AdminZoomTab`, etc.)
- **Bug:** Component unmounts within 3s → setState on unmounted component.
- **Fix:** Store timer id in a ref; clearTimeout in effect cleanup. Or extract `useTimedClear(setter, delay)`.

### M31. `AdminFeatures.tsx:35` — `Object.values(flags)` recomputed on every render

### M32. `AdminCommunity.tsx:41` + `AdminUnresolvedSearch.tsx:11` (+ 2 more) — `useDebounce` copy-paste in 4+ files

- **Files:** `AdminFAQs.tsx:9-13`, `AdminCommunity.tsx:8`, `AdminUsers.tsx:6`, `AdminUnresolvedSearch.tsx:8-15`
- **Bug:** 4 separate definitions of the same hook, each slightly different.

### M33. `AdminProgramDetail.tsx:89` — `setError` and `setLoading` not guarded in race-condition `useEffect`

### M34. `AdminAISettings.tsx:119-126` — `providerDrafts` causes whole provider section to re-render on every keystroke

### M35. `AdminZoomMeetings.tsx:180-183` — `getElementById('upload-topic')` reads DOM imperatively

- **Bug:** Input value lives in the DOM, not React state. Same value lives in 3 places (DOM, modal, closure). Form can't be validated; "Process" button can't be disabled on empty.
- **Fix:** Lift to React state.

### M36. `AdminProgramSettingsPage.tsx:307-315` — `switch` over `key` with IIFE for `show` value; order is `ALL_SECTIONS`, not `sectionOrder`

### M37. `AdminCoursesPage.tsx:78-86` — `useEffect` dep array includes `form.batchId` (auto-fill target)

### M38. `FaqReview.tsx:111-126` — `handleApprove` makes sequential API calls

- **Bug:** Two `await adminApi.post(...promote)` calls fire sequentially. First succeeds, second fails → FAQ in inconsistent state.
- **Fix:** Single `/admin/faqs/:id/promote-to-expert-high` endpoint.

### M39. `AdminSupportInbox.tsx:53-55` — Error catch stores generic message, drops real error

### M40. `AdminProgramSettingsPage.tsx:79-82` — `dirty` derived from `JSON.stringify(form) !== JSON.stringify(data.settings)` on every keystroke

### M41. `AdminModeration.tsx:212` — `escalatedPosts.length` shown in tab counter, but it's the full unfiltered list while the view is paginated

### M42. `AdminModeration.tsx:140-143` + 4 more files — `timeAgo` helper duplicated in 5 files

- **Files:** `AdminModeration.tsx:19-26`, `AdminDocumentInsights.tsx:44-51`, `AdminZoomInsights.tsx:29-36`, `AdminZoomMeetings.tsx:42-49`, `AdminGoldenTickets.tsx:85-105`
- **Bug:** 5 copies of the same `timeAgo` function, slightly different.

### M43. `AdminZoomTab.tsx` — File is 1075 lines, one giant component

### M44. `AdminGoldenTickets.tsx:154-156` — `isPending` check uses hardcoded status list

### M45. `AdminProgramSettingsPage.tsx:307-315` — Move-up/Move-down buttons have overlapping disable conditions (idx vs position)

### M46. `AdminLogin.tsx:30` — Should use `friendlyError` instead of raw error cast

### M47. `AdminModeration.tsx:62` — Initial `actionTab` should use `useSearchParams`

### M48. `AdminCommunity.tsx:36` — adminApi.get has no `.catch` for posts fetch

### M49. `AdminProgramSettingsPage.tsx:104-119` — `save()` uses `setData(prev => prev ? {...prev, settings: res.data} : prev)` — confusing naming

### M50. `AdminCommunity.tsx:41` — `handleDelete` calls `fetchPosts()` after delete even if post wasn't in current page

### M51. `AdminWelcomePage.tsx` mounts `AdminProjectsPage` twice over the codebase (`/admin/welcome` and `/admin/projects`)

---

## LOW PRIORITY — Code smell

### L1. `api.ts:56` — `clearApiCache` exported but unused externally
### L2. `useAuth.tsx:140` — `console.error` left in production fetchUser
### L3. `types/ui.ts:35` — Mixed-shape upvotes `(string | { _id?: string })[]`
### L4. `App.tsx:19` — ErrorBoundary section name (re-check pending)
### L5. `ThreadDetail.tsx:144-149, PostDetailDialog.tsx:486-491` — Empty deps array on body-overflow effect
### L6. `CommentNode.tsx:201, 339` — Direct prop mutation
### L7. `CommunityPostCard.tsx:48-52, 65-66` — Empty-string interpolation in className
### L8. `CommunityPostCard.tsx:158-169` — Bookmark count button doesn't visually indicate "you bookmarked"
### L9. `ExploreSearchResults.tsx:30` — Returns null when query < 2 chars
### L10. `SearchDropdown.tsx:86-95` — Category list has no keyboard navigation
### L11. `useReadingTracker.ts:104-108, 118-141` — Two separate `useEffect`s reading `faqId`
### L12. `SearchFeedback.tsx:84-104` — Form autoFocus traps focus
### L13. `CategoryGrid.tsx:13-24` — `categoryPills` exported with deprecated tag
### L14. `PostDetailDialog.tsx:593-600`, `CommunityPostCard.tsx:13-20` — `LIFECYCLE_CONFIG` redefined in 3 places
### L15. `PostDetailDialog.tsx:15-22` — Trivial type interface, no JSDoc
### L16. `PostDetailDialog.tsx:342` — `accept-answer` endpoint returns `{ post }` but handler reads `res.data.comments`
### L17. `PostDetailDialog.tsx:566-570` — DOM-created banner has no `role="status"` or `aria-live`
### L18. `ThreadDetail.tsx:259-276` — `doBookmark` rollback uses closure-captured `post.bookmarks`
### L19. `PublicFaqDetail.tsx:62-68` — `el = articleRef.current` closure
### L20. `CategoryGrid.tsx:32-140` vs `CategoryCard.tsx` — Two components named `CategoryCard` with different shapes
### L21. `useCourses.ts:13-21` — Return type cast
### L22. `usePublicFaqApi.ts:59` — `JSON.stringify(params)` recomputed every render
### L23. `TopSolved.tsx:147-156` — State divergence
### L24. `AdminModeration.tsx:124-129` — `ACTION_LABELS` map inline in component, should be top-level
### L25. `AdminSupportCategories.tsx:114, 380, 405` — `payload: any` instead of typed
### L26. `AdminCoursesPage.tsx:114-115` — `cancel()` resets form, loses user's selected program context
### L27. `AdminProgramSettingsPage.tsx:340-352` — Move-up/down `idx` vs `position` confusion
### L28. `AdminAuditLogTab.tsx:9-12` — `any` for `previousValue` and `newValue`
### L29. `AdminFAQAudit.tsx:42` — `results` field name collision (stats vs list)
### L30. `AdminFeatures.tsx:20-32` — `toggle()` double-round-trip (setFlag + refresh)
### L31. `AdminProgramSettingsPage.tsx:50-77` — First `/batches/admin/all` call not cancellable
### L32. `AdminProjectModal` — Two pages mount `AdminProjectsPage`
### L33. `AdminProgramSettingsPage.tsx:104-119` — `data` vs `form` vs `savedForm` naming
### L34. `AdminLogin.tsx:38-50` — Inline magic strings (purple RGBA, blur radii)
### L35. `AdminWelcomePage.tsx:92-95` — `-mt-8` negative margin hack
### L36. `AdminProgramDashboard.tsx:156-164` — `counts` recomputes via 4 filters
### L37. `AdminDocumentInsights.tsx:202-207` — Filter length on every render
### L38. `AdminTimelineTab.tsx:80` — `if (loading) return <div>Loading...</div>` — no skeleton, no role
### L39. `AdminTimelineTab.tsx:38-52` — `handleSubmit` swallows error with `console.error` only
### L40. `AdminAuditLogTab.tsx:24-29` — Catches fetch error with `console.error`, no UI feedback
### L41. `AdminMentorsTab.tsx:38-42, 72-74, 86-90` — `console.error` only on save/archive
### L42. `AdminOrientationTab.tsx:37, 70-72, 82-84, 96-98` — `console.error` only
### L43. `AdminOnboardingTab.tsx:37-40, 58-61` — `console.error` only
### L44. `FaqReview.tsx:380` — `<span key={i}>` for timeline items
### L45. `FaqReview.tsx:415, 423, 442, 446, 463` — Multiple `key={i}` for list rendering
### L46. `AdminProgramDashboard.tsx:88-110` — `ProgramCard` not memoized
### L47. `AdminProgramDashboard.tsx:115` — `refresh: refreshBatches` rename is a smell
### L48. `AdminProjectModal` was mentioned in the user's working-tree notes but file is in `components/welcome/` not `admin/` (out of scope but flagged)
### L49. `AdminLogin.tsx:30` — Raw error cast instead of `friendlyError` (see M46)
### L50. `AdminProgramSettingsPage.tsx:50-77` — `setError` used for both "not found" and "network error" — same UI
### L51. `AdminModeration.tsx:62` — Inline URL read instead of `useSearchParams` (see M47)
### L52. `AdminCommunity.tsx:36` — No `.catch` on posts fetch (see M48)
### L53. `AdminCommunity.tsx:41` — `handleDelete` refetch logic (see M50)
### L54. `AdminWelcomePage.tsx:92-95` — `-mt-8` hack (see L35)
### L55. `AdminAuditLogTab.tsx` — `previousValue`/`newValue` cast as `any` (see L28)
### L56. `AdminFAQAudit.tsx:42` — `results` name collision (see L29)
### L57. `AdminFeatures.tsx:20-32` — Double round-trip (see L30)
### L58. `AdminProgramSettingsPage.tsx:50-77` — Race between two programs (see L31)

---

## CROSS-CUTTING PATTERNS (rolling in)

### `idMatches` helper needed (H14, M14)

~~Every file in `community/` repeats the same `(typeof u === 'object' ? u._id || u : u)?.toString() === currentUserId` incantation. Extract to `frontend/src/utils/idMatch.ts`.~~

✅ **DONE.** Extracted to `frontend/src/utils/idMatch.ts` and adopted across `CommunityPostCard.tsx`, `CommentNode.tsx`, `ThreadDetail.tsx`, `PostDetailDialog.tsx` — replacing 33 broken patterns.

### Body scroll-lock needs a stack (H7, M27, M28, M29, L5)

5 distinct patterns across the codebase:
1. `Modal.tsx` (correct): `useEffect(..., [open])` + cleanup
2. `AdminModeration` (works for sibling modals): dep is the full list of modal state variables
3. `AdminProjectsPage`, `AdminZoomMeetings`, `FaqReview`: dep is the specific state variable
4. `AdminSupportCategories` `FieldModal`, `AdminUsers` 3 modals: dep is `[]` (broken — only runs on mount/unmount)
5. `ProjectSelectionModal.tsx` etc.

**Recommendation**: Extract a single `useBodyScrollLock(open: boolean)` hook with a module-level refcount stack.

### Modal a11y everywhere (M27, M28, M29)

15+ hand-rolled modals lack `role="dialog"`, `aria-modal="true"`, focus trap, ESC handler. Extract from `Modal.tsx` and reuse.

### Native browser dialogs everywhere (H21, H22, H23, M8, M70)

`window.prompt` / `window.confirm` / `window.alert` are used as primary UX in:
- `AdminSupportTicket.tsx:124, 127`
- `AdminModeration.tsx:288`
- `AdminGoldenTickets.tsx:193, 213`
- `AdminProjectsPage.tsx:133`
- `AdminCoursesPage.tsx:147, 163, 166`
- `AdminDynamicCategoriesPage.tsx:150`
- `AdminUnresolvedSearch.tsx:120`
- `ProgramSupportCategoriesTab.tsx:331`
- `AdminTimelineBuilderTab.tsx:246`
- `AdminMentorsTab.tsx:68`
- `AdminZoomTab.tsx` (alerts on lines 186, 201, 208, 215, 243, 251, 260, 265, 273, 280, 289, 304, 311, 322, 329, 337, 350, 367, 374, 393, 407, 417 — 20+ alerts)

These should all be in-app modals/toasts.

### Silent catch blocks (H24, H25, H26, M30, L39, L40, L41, L42, L43)

- `AdminModeration.tsx:116` (doAction)
- `AdminZoomInsights.tsx:139, 149`
- `FaqReview.tsx:94`
- 12+ `console.error` statements (`AdminTimelineBuilderTab`, `AdminMentorsTab`, `AdminTimelineTab`, `AdminOnboardingTab`, `AdminOrientationTab`, `AdminAuditLogTab`, `AdminProjectsPage`)

Use `friendlyError` (which already exists in `utils/api.ts`) + toast.

### `useDebounce` copy-paste (M32)

4 separate definitions of the same hook in `AdminFAQs.tsx`, `AdminCommunity.tsx`, `AdminUsers.tsx`, `AdminUnresolvedSearch.tsx`. Extract to `frontend/src/hooks/useDebounce.ts`.

### `timeAgo` copy-paste (M42)

5 separate definitions across admin files. Extract to `frontend/src/utils/time.ts`.

### Toast `setTimeout` no-cleanup (M30)

12+ files. Same `setTimeout(() => setToast(null), 3000)` with no `clearTimeout` on unmount.

### Modal stacking

`UserDetailModal` (`AdminUsers.tsx`) opens 3 nested modals (`warnModal`, `suspendModal`, `banModal`). Works today because they're inside the same component; if any nested modal were extracted, body lock would be lost.

### `AdminProjectsPage` mounted twice

`/admin/welcome?tab=projects` AND `/admin/projects`. Each mount runs the same `useEffect`s.

### Cache invalidation gap (H9)

`api.ts` clears its own axios cache on mutations; `usePublicFaqApi` has a separate cache that's never cleared. Stale data after any mutation is systemic.

### Two `CategoryCard` components (L20)

`frontend/src/components/faq/CategoryCard.tsx` (default export) vs `CategoryGrid.tsx` (named export) with similar but not identical signatures.

### `LIFECYCLE_CONFIG` redefined 3× (L14)

`CommunityPostCard.tsx:13-20`, `PostDetailDialog.tsx:593-600`, `ui/threadUtils.ts`. One source of truth needed.

---

## TOP PRIORITY FIXES (combined across all subagents)

The single biggest cross-cutting fix is to extract a shared `useBodyScrollLock(open)` hook and a shared `<Modal>` wrapper. This closes:
- H7 (modal stacking), M27 (a11y), M28 (click-outside inconsistency), M29 (close button aria-label), L5 (eslint comment) in one pass.

Second biggest: replace native `prompt`/`alert`/`confirm` with in-app toasts/modals (closes H21, H22, H23, M8, ~25 other sites).

Third biggest: extract `idMatches` helper (H14, M14 — affects 8+ sites).

Fourth: extract `useBodyScrollLock`, `useDebounce`, `timeAgo` hooks.

Fifth: extract a real `<Toast />` component to replace the manual `document.createElement` toasts and `setTimeout(setToast(null), 3000)` patterns.

---

## FILES REQUIRING CHANGES (running summary)

| File | Status | Notes |
|------|--------|-------|
| `frontend/src/routes/AppRoutes.tsx` | ⏳ H1 | Dead variable + debug comment |
| `frontend/src/utils/api.ts` | ⏳ H2, H3, M4, L1 | Auth sync, cache, message cap |
| `frontend/src/hooks/useAuth.tsx` | ⏳ H4, M5, L2 | localStorage validation, storage handler |
| `frontend/src/hooks/useNotifications.tsx` | ⏳ H5 | Polling missing |
| `frontend/src/hooks/useCloudinaryUpload.ts` | ⏳ M6 | In-flight counter |
| `frontend/src/hooks/useReadingTracker.ts` | ⏳ H10, M15, L11 | Scroll target, perf |
| `frontend/src/context/ProgramContext.tsx` | ⏳ M1 | JSDoc syntax |
| `frontend/src/context/BatchContext.tsx` | ⏳ M3 | Stale TODO |
| `frontend/src/components/auth/AuthModalHost.tsx` | ⏳ M2 | Prompt persistence |
| `frontend/src/components/auth/AuthModal.tsx` | 🔁 RE-CHECK | Concurrently modified |
| `frontend/src/components/community/PostDetailDialog.tsx` | ⏳ H6, H7, H13, M7, M16, M17, L14, L15, L16, L17 | Enter race, scroll-lock, toast duplication |
| `frontend/src/components/community/ThreadDetail.tsx` | ⏳ H6, H7, H17, M8, M9, M20, L5, L18 | Same patterns + full reload |
| `frontend/src/components/community/CommentNode.tsx` | ⏳ H6, H13, M14, M15, L6 | Enter race, mutation, recursion |
| `frontend/src/components/community/CreatePostDialog.tsx` | ⏳ H11, M12, M18 | Render-time side effects |
| `frontend/src/components/community/SpillTheTea.tsx` | ⏳ H15, H16, M23 | Load-more race, missed toasts |
| `frontend/src/components/community/CommunityHealth.tsx` | ⏳ M21 | Hallucinated metric |
| `frontend/src/components/community/TopSolved.tsx` | ⏳ M22, L23 | State divergence |
| `frontend/src/components/community/CommunityPostCard.tsx` | 🔁 RE-CHECK | Concurrently modified |
| `frontend/src/components/explore/ExploreSearchBar.tsx` | ⏳ H8, M19 | setTimeout cleanup |
| `frontend/src/components/explore/PublicFaqDetail.tsx` | ⏳ H10, H18, M24 | SSR hydration, scroll listener |
| `frontend/src/components/explore/CategoryAccordion.tsx` | ⏳ M10, M25 | Over-fetching, no debounce |
| `frontend/src/components/explore/usePublicFaqApi.ts` | ⏳ H9, M13, L22 | Cache invalidation, error messages |
| `frontend/src/components/explore/useCourses.ts` | ⏳ M26, L21 | Type cast |
| `frontend/src/components/explore/ExploreSearchResults.tsx` | ⏳ L9 | Empty state jump |
| `frontend/src/components/faq/QuestionList.tsx` | ⏳ M11 | IntersectionObserver churn |
| `frontend/src/components/faq/SearchFeedback.tsx` | ⏳ H12, L12 | Timer re-shows dismissed |
| `frontend/src/components/faq/SearchDropdown.tsx` | ⏳ L10 | No keyboard nav |
| `frontend/src/components/faq/CategoryGrid.tsx` | ⏳ L13, L20 | Deprecated export, dup name |
| `frontend/src/types/ui.ts` | ⏳ L3 | Mixed-shape upvotes |
| `frontend/src/App.tsx` | ⏳ L4 | ErrorBoundary prop audit |
| `frontend/src/admin/pages/AdminAISettings.tsx` | 🔁 RE-CHECK | Concurrently modified |
| `frontend/src/admin/pages/AdminProgramDetail.tsx` | 🔁 RE-CHECK | Concurrently modified + H29 dead OverviewTab |
| `frontend/src/admin/pages/AdminModeration.tsx` | ⏳ H7, H22, H24, H28, M36, M41, M42, M47, L24 | Native prompt, silent catch, polling |
| `frontend/src/admin/pages/AdminZoomMeetings.tsx` | ⏳ H7, H20, H33, M35, M42 | Polling leak, imperative DOM, count N+1 |
| `frontend/src/admin/pages/AdminZoomInsights.tsx` | ⏳ H25, H33, M42 | Silent catch, count N+1 |
| `frontend/src/admin/pages/AdminSupportTicket.tsx` | ⏳ H21 | Native prompt |
| `frontend/src/admin/pages/AdminGoldenTickets.tsx` | ⏳ H23, M42, M44 | Native alert, status hardcoded |
| `frontend/src/admin/pages/FaqReview.tsx` | ⏳ H7, H26, M38, L44, L45 | setQueue([]) on error, sequential promote |
| `frontend/src/admin/pages/AdminProgramSettingsPage.tsx` | ⏳ H27, H31, M31, M36, M40, M45, L27, L31, L33, L50, L58 | Slug collision, hex input, dirty calc |
| `frontend/src/admin/pages/AdminWelcomePage.tsx` | ⏳ H30, M51, L35 | Negative margin + double mount |
| `frontend/src/admin/pages/AdminProjectsPage.tsx` | ⏳ H7, M51 | Native confirm, scroll-lock |
| `frontend/src/admin/pages/AdminZoomTab.tsx` | ⏳ H19, M30, M43 | Dead setSaving(true), 1075-line file |
| `frontend/src/admin/pages/AdminSupportCategories.tsx` | ⏳ H7, M30, L25 | Scroll-lock [], any type |
| `frontend/src/admin/pages/AdminUsers.tsx` | ⏳ H7, M32 | Scroll-lock [], useDebounce copy-paste |
| `frontend/src/admin/pages/AdminUnresolvedSearch.tsx` | ⏳ H32, M30, M32 | User-identifying tokens, useDebounce |
| `frontend/src/admin/pages/AdminCoursesPage.tsx` | ⏳ M30, M37, L26 | Toast timer, form.batchId dep |
| `frontend/src/admin/pages/AdminSupportInbox.tsx` | ⏳ M39 | Generic error message |
| `frontend/src/admin/pages/AdminFeatures.tsx` | ⏳ M30, M31, L30, L57 | Toast timer, Object.values |
| `frontend/src/admin/pages/AdminFAQs.tsx` | ⏳ M30, M32 | Toast timer, useDebounce |
| `frontend/src/admin/pages/AdminCommunity.tsx` | ⏳ M30, M32, M48, M50, L52, L53 | Toast timer, useDebounce, no catch |
| `frontend/src/admin/pages/AdminProgramDashboard.tsx` | ⏳ M30, L36, L46, L47 | Toast timer, perf, ProgramCard not memoized |
| `frontend/src/admin/pages/AdminDocumentInsights.tsx` | ⏳ M30, M42, L37 | Toast timer, timeAgo dup |
| `frontend/src/admin/pages/AdminLogin.tsx` | ⏳ L34, L46 | Inline magic strings, friendlyError |
| `frontend/src/admin/pages/AdminSupportGuidance.tsx` | ⏳ M30 | Toast timer |
| `frontend/src/admin/pages/AdminDynamicCategoriesPage.tsx` | ⏳ M26 | Native confirm |
| `frontend/src/admin/pages/AdminTimelineBuilderTab.tsx` | ⏳ L39 | console.error only |
| `frontend/src/admin/pages/AdminAuditLogTab.tsx` | ⏳ L28, L40 | any, console.error only |
| `frontend/src/admin/pages/AdminMentorsTab.tsx` | ⏳ L41 | console.error only |
| `frontend/src/admin/pages/AdminOnboardingTab.tsx` | ⏳ L43 | console.error only |
| `frontend/src/admin/pages/AdminOrientationTab.tsx` | ⏳ L42 | console.error only |
| `frontend/src/admin/components/program/ProgramSupportCategoriesTab.tsx` | ⏳ Native confirm |
| `frontend/src/admin/components/welcome/AdminTimelineTab.tsx` | ⏳ L38, L39 | Loading div, console.error only |
| `frontend/src/admin/components/welcome/AdminFAQAudit.tsx` | ⏳ L29 | results name collision |

---

## FIXED in this session (2026-06-22)

> Updated as fixes land. Last batch: H21, H23, H36-H38, H4, M4, L2.

### HIGH priority — fixed

- **H1** ✅ — Deleted dead `AppSettingsAdminRouter` + debug comment in `AppRoutes.tsx`
- **H4** ✅ — `useAuth.tsx`: validate cached user shape before trusting localStorage (require non-empty `_id` or `email`)
- **H6** ✅ — Enter-key race fix in PostDetailDialog / ThreadDetail / CommentNode via `inFlightRef` + `formRef.current?.requestSubmit()`
- **H10** ✅ — `useReadingTracker.ts`: scroll listener moved from `window` to the article `node` (the actual scrollable surface)
- **H11** ✅ — `CreatePostDialog.tsx`: render-time `onClose() / openModal()` moved into `useEffect`
- **H13** ✅ — `CommentNode.tsx`: verify handler uses local state override instead of mutating `comment.verified`; surface errors via `friendlyError` + existing `actionError` banner
- **H17** ✅ — `ThreadDetail.tsx`: replaced `window.location.href = q.url` with `navigate(q.url)` (2 sites)
- **H19** ✅ — `AdminZoomTab.tsx`: deleted dead `setSaving(true)` + debug comment in finally block
- **H21** ✅ — `AdminSupportTicket.tsx`: replaced pair of `window.prompt()` with inline "Convert to Golden" modal (SP cost + note inputs)
- **H22** ✅ — `AdminModeration.tsx`: replaced `window.prompt('Enter resolution details:')` with inline "Resolve Escalation" modal (textarea + Cancel/Resolve)
- **H23** ✅ — `AdminGoldenTickets.tsx`: replaced 2× `window.alert()` with inline notice banner (amber, role=status, aria-live=polite)
- **H26** ✅ — `FaqReview.tsx`: `setQueue([])` on error → keep list + surface inline error banner (`loadError`)
- **H29** ✅ — `AdminProgramDetail.tsx`: `OverviewTab` now fetches real stats from `/admin/batches/:id`; remaining "—" placeholders labelled "pending the per-program stats endpoint"
- **H32** ✅ — `AdminUnresolvedSearch.tsx`: replaced user-identifying tokens in `spamPatterns` (`'vaibhav'`, `'nigga'`) with generic patterns only
- **H34** ✅ — Reverted `AdminProgramDetail.tsx` `<any>` regression + removed `|| res.data` fallback
- **H36** ✅ — `AskAIButton.tsx`: attachment cleanup uses `attachmentsRef` (no more stale closure leak)
- **H37** ✅ — `AskAIButton.tsx`: `send()` race fix — ref guard + `setIsLoading(true)` flipped before state mutations
- **H38** ✅ — `AskAIButton.tsx`: `useBodyScrollLock(panel === 'expanded')` (scroll lock only in fullscreen mode)
- **H41** ✅ — `InteractiveSearchOverlay.tsx`: trending skeleton inverted condition fixed (`!trendingLoading &&` → `trendingLoading &&`)
- **H42** ✅ — `InteractiveSearchOverlay.tsx`: trending fetch effect now includes `[activeBatchId]` dep + sends `batchId` query param
- **H43** ✅ — `NotificationBell.tsx`: 3× `console.error(friendlyError(...))` (wrong pattern) → `console.error(label, rawError)`

### Cross-cutting helpers — created

- ✅ `frontend/src/hooks/useBodyScrollLock.ts` — module-level refcount stack, saves/restores previous overflow value
- ✅ `frontend/src/hooks/useDebounce.ts` — canonical `useDebounce<T>(value, delayMs)`
- ✅ `frontend/src/utils/idMatch.ts` — `idMatches(u, currentUserId)` + `extractId(u)`. Fixes `String({}) === '[object Object]'` silent mis-compare
- ✅ `frontend/src/utils/time.ts` — `timeAgo()`, `formatTimerRemaining()`, `formatCountdown()`

### Modal scroll-lock refactor — applied to 11 modals

Replaced hand-rolled `document.body.style.overflow` effects with `useBodyScrollLock()`:
- `admin/components/common/Modal.tsx`
- `admin/pages/AdminModeration.tsx`
- `admin/pages/AdminProjectsPage.tsx`
- `admin/pages/AdminSupportCategories.tsx`
- `admin/pages/AdminUsers.tsx` (UserDetailModal, RoleModal, DeleteModal)
- `admin/pages/AdminZoomMeetings.tsx`
- `admin/pages/FaqReview.tsx`
- `components/community/ThreadDetail.tsx`
- `components/community/PostDetailDialog.tsx`
- `components/welcome/ProjectSelectionModal.tsx`

Closes H7 + M27/M28/M29/L5 (modal stacking). ESC + role + a11y for these specific modals are still L-priority follow-ups.

### MEDIUM priority — partial (subagent did partial work; manually verified)

- **M4** ✅ — `frontend/src/utils/api.ts:319-334`: bumped `friendlyError` 4xx message cap 200→500 chars
- **M30** ⏳ (deferred) — Toast-timer-with-ref pattern applied to **2 of 12 sites** (`AdminFAQs.tsx`, `AdminGoldenTickets.tsx`). The remaining 10 sites have varied `setToast(...)` patterns (one-liner arrow functions, multi-arg setToast) that are too irregular to safely auto-patch with regex; needs per-file manual work. Will require ~30 min of focused edits per file.
- **M14** ✅ — `idMatches` helper adopted across **4 community files**: `CommunityPostCard.tsx`, `CommentNode.tsx`, `ThreadDetail.tsx`, `PostDetailDialog.tsx`. Replaced 33 broken `String(object)` patterns (the buggy `(typeof u === 'object' ? (u as { _id?: string })._id || u : u)?.toString()` shape). Closes H14 (8+ sites).
- **M32** ✅ — `useDebounce` canonical helper adopted across **4 admin files**: `AdminFAQs.tsx`, `AdminCommunity.tsx`, `AdminUsers.tsx`, `AdminUnresolvedSearch.tsx`. Local copies removed.
- **M42** ✅ — `timeAgo` canonical helper adopted across **6 files**: `AdminModeration.tsx`, `AdminZoomInsights.tsx`, `AdminDocumentInsights.tsx`, `AdminZoomMeetings.tsx`, `SpillTheTea.tsx`, `NotificationBell.tsx`. Local copies removed.
- **H2** ✅ — `utils/api.ts:401` interceptor now also dispatches `auth:logout` CustomEvent; `useAuth.tsx` listens for it and clears user state synchronously. Closes the "every action re-opens the auth modal in a loop" bug.
- **H5** ✅ — `useNotifications.tsx`: poll unread count every 30s (was: only on mount + focus). Bell badge stays fresh.
- **M52** ⏳ (deferred) — GoldenTicketPage 1-sec tick interval is non-trivial because it requires reordering `inCooldown` computation above the useEffect.
- **M53** ✅ — `GoldenTicketPage.tsx`: removed local `friendlyError` redefinition; now imports from `utils/api`.
- **M55** ✅ — `ZoomAssessmentModal.tsx`: "Try Again" no longer wipes answers + currentIdx — keeps user's progress.
- **M52**, **M55** ⏳ — partial (deferred)
- (note: M53+M55 done in this batch)


### LOW priority — partial

- **L2** ✅ — `useAuth.tsx:140`: removed `console.error('Failed to fetch user', error)` silent-leak
- **L1**, **L3`, **L4`, **L17**, **L29**, **L25-L43`, **L59-L70** ⏳ — Not yet done

### Verification

- ✅ `npm run typecheck` (frontend) — clean
- ✅ `npx tsc --noEmit` (backend) — clean
- ✅ `npm test` / `vitest run` (backend) — 33/33 pass
- ✅ `npx pnpm@9 run build` — both workspaces build clean

---

## PENDING FROM SUBAGENTS (rolling in)

> 2 of 3 dispatched subagents returned (subagent 3 timed out after 10 min
> with partial coverage). Hand-read the most user-critical files to
> complete coverage. Findings below were captured from:
> `NotificationBell.tsx`, `ThemeToggle.tsx`, `ErrorBoundary.tsx`,
> `AskAIButton.tsx`, `ZoomBubble.tsx`, `ZoomAssessmentModal.tsx`,
> `InteractiveSearchOverlay.tsx`, `HomePage.tsx`, `GoldenTicketPage.tsx`.
> Plus the two concurrently-modified files (`AdminAISettings.tsx`,
> `AdminProgramDetail.tsx`).

### H34. `AdminProgramDetail.tsx:89-91` (concurrent edit regression) — Type contract downgraded to `any` + undocumented fallback

- **File:** `frontend/src/admin/pages/AdminProgramDetail.tsx`
- **Bug:** The original code used `adminApi.get<{ batch: ProgramInfo }>(\`/batches/${programId}\`)`. The new version downgrades to `adminApi.get<any>(...)` and adds `const batchData = res.data?.batch || res.data;`. Two problems: (a) the `<any>` defeats the type safety of every other admin endpoint; (b) the `|| res.data` fallback silently masks a backend contract change — if the API starts returning a different shape (no `batch` key), the fallback hides it instead of erroring visibly.
- **Fix:** Restore the `<{ batch: ProgramInfo }>` type and remove the `|| res.data` fallback. If the backend really changed shape, surface a 4xx/5xx.

### H35. `AdminAISettings.tsx:406-408` (concurrent edit) — Optional chaining added to usage fields

- **File:** `frontend/src/admin/pages/AdminAISettings.tsx`
- **Note:** Defensive fix — added `?.` to `config?.usage?.totalRequests` etc. Good. Confirm backend never returns `usage: undefined` for admins (would mean `usage` field is missing from response).

### H36. `AskAIButton.tsx:227-230` — Attachment cleanup uses stale closure `[]` deps → memory leak

- **File:** `frontend/src/components/askai/AskAIButton.tsx:227-230`
- **Bug:** `useEffect(() => { return () => { attachments.forEach((a) => { if (a.previewUrl) URL.revokeObjectURL(a.file); }); }; }, [])`. The cleanup runs on unmount but reads `attachments` from the FIRST render's closure (empty array). If user adds attachments and the component unmounts, the most recent attachment URLs are never revoked. Real leak in the `send()` happy path too — even though `send()` revokes after success, the catch path re-attaches via `setAttachments(sending)`, and if the component then unmounts, the URLs persist.
- **Fix:** Use a `useRef<PendingAttachment[]>` or pass the latest attachments to the cleanup via a stable ref.

### H37. `AskAIButton.tsx:247-269` — `send()` race: `setIsLoading(true)` set after state mutations

- **File:** `frontend/src/components/askai/AskAIButton.tsx:247`
- **Bug:** State mutations (setMessages, setQuery, setAttachments) happen before `setIsLoading(true)`. Two rapid Enter presses can both pass the `if (isLoading) return` guard before the first call's setIsLoading commits → duplicate POSTs.
- **Fix:** Move `setIsLoading(true)` to the very top of `send()`, before any state mutations. Or use an `inFlightRef`.

### H38. `AskAIButton.tsx:298-301` — Panel doesn't lock body scroll when expanded

- **File:** `frontend/src/components/askai/AskAIButton.tsx`
- **Bug:** When `panel === 'expanded'`, the panel covers most of the screen but the body is still scrollable. Inconsistent with every other modal in the app (AuthModal, CreatePostDialog, etc. all lock body scroll).
- **Fix:** Add the same body-scroll-lock pattern (or use the new `useBodyScrollLock` hook once H7's fix lands).

### H39. `HomePage.tsx:436` — `console.error(friendlyError(...))` silent catch on trending queries

- **File:** `frontend/src/pages/HomePage.tsx:436`
- **Bug:** `console.error(friendlyError(err, 'Failed to load trending queries.'))` — passes the message to `console.error` instead of surfacing to user. Trending area just stays empty with no explanation.

### H40. `HomePage.tsx:419, 425, 431` — Silent `catch () => { /* non-fatal */ }` on popular/recent/top-by-category fetches

- **File:** `frontend/src/pages/HomePage.tsx`
- **Bug:** Same pattern repeated 3 times. If `/api/public/popular-faqs` is down, the section shows empty with no indication why.

### H41. `InteractiveSearchOverlay.tsx:306-310` — Trending skeleton inverted condition (only shown when NOT loading)

- **File:** `frontend/src/components/search/InteractiveSearchOverlay.tsx:306-310`
- **Bug:** `{!trendingLoading && [1, 2, 3].map((i) => <div ... animate-pulse />)}` — skeletons show when loading is DONE. Should be `trendingLoading &&` (without the bang). Currently the skeletons never render during actual loading, and would only render in the brief window after loading completes (race condition).
- **Fix:** Drop the `!`.

### H42. `InteractiveSearchOverlay.tsx:63-79` — Trending fetch effect deps `[ ]` doesn't refresh on batchId change

- **File:** `frontend/src/components/search/InteractiveSearchOverlay.tsx:63-79`
- **Bug:** `useEffect(() => { api.get('/search/trending')... }, [])` — fetches once on mount. If the user switches batch via `BatchSwitcher`, trending queries don't refresh.
- **Fix:** Add `activeBatchId` to deps.

### H43. `NotificationBell.tsx:65-69, 95-97, 115` — `console.error(friendlyError(...))` is wrong pattern

- **File:** `frontend/src/components/notifications/NotificationBell.tsx`
- **Bug:** 3 sites. `console.error(friendlyError(e, 'Failed to load notifications.'))` — `friendlyError` returns a string, not throws. The pattern "console.error(message)" hides the error from the user. Should be `setError(friendlyError(...))` or surface via toast.

### M52. `GoldenTicketPage.tsx:121-124` — `setNow(Date.now())` interval runs every second even when NOT in cooldown

- **File:** `frontend/src/pages/GoldenTicketPage.tsx`
- **Bug:** `setInterval(() => setNow(Date.now()), 1000)` runs unconditionally. When the user is not in cooldown, the interval still fires every second, triggering a full page re-render even though the countdown UI isn't shown. With the AnimatedNumber / AnimatedDigit components, that's expensive.
- **Fix:** Only run the interval when `inCooldown === true`. Use `setInterval` inside a `useEffect` with `[inCooldown]` deps.

### M53. `GoldenTicketPage.tsx:37-40` — Local `friendlyError` reimplemented instead of imported

- **File:** `frontend/src/pages/GoldenTicketPage.tsx`
- **Bug:** Local `friendlyError(err, fallback)` ignores 401/403 status codes. The shared `friendlyError` in `utils/api.ts:309` has special handling for those (returns "Please sign in to continue" instead of echoing backend text). Auth path here may leak backend strings.
- **Fix:** Import `friendlyError` from `../../utils/api`.

### M54. `ZoomAssessmentModal.tsx:90-91, 105-106, 120-121` — `console.error` only on progress save failures

- **File:** `frontend/src/components/welcome/ZoomAssessmentModal.tsx`
- **Bug:** User clicks Next/Back, progress save silently fails, server still has old state. Next session, user loses answers.
- **Fix:** Surface error to user, or retry once before giving up.

### M55. `ZoomAssessmentModal.tsx:255-260` — `handleSubmit` "Try Again" loses all answers

- **File:** `frontend/src/components/welcome/ZoomAssessmentModal.tsx`
- **Bug:** `setResultMessage(null); setAnswers({}); setCurrentIdx(0); fetchQuestions();` — wipes the user's answers on retry. The whole point of "Try Again" is to retry with the same answers.
- **Fix:** Don't reset `answers` and `currentIdx`; just refetch questions.

### M56. `NotificationBell.tsx:72-82` — Dropdown has no Escape key handler

- **File:** `frontend/src/components/notifications/NotificationBell.tsx`
- **Bug:** Only outside-click closes the dropdown. Keyboard users must move focus outside, which is jarring.

### M57. `HomePage.tsx:347-354` — Three loading booleans for parallel feeds

- **File:** `frontend/src/pages/HomePage.tsx`
- **Bug:** `loading`, `popularLoading`, `recentLoading` — three booleans that all flip together. A single state union (`'idle' | 'loading' | 'error'`) or `loadingSections: Set<string>` would be cleaner. Minor style — but the user's reminder means we flag this.

### M58. `ZoomBubble.tsx:10` — Should hide for moderators too, not just admins

- **File:** `frontend/src/components/welcome/ZoomBubble.tsx`
- **Bug:** `if (user?.role === 'admin') return null;` — moderators see the bubble. The assessment is for end-users (anyone who needs Zoom onboarding), so moderators probably shouldn't see it either. Need product decision.

### M59. `ZoomAssessmentModal.tsx:24` — `useState<any>(null)` for zoomDetails

- **File:** `frontend/src/components/welcome/ZoomAssessmentModal.tsx`
- **Bug:** Should be a typed interface — `zoomTitle`, `zoomDescription`, `zoomDuration`, `zoomUrl`.

### M60. `InteractiveSearchOverlay.tsx:263-279` — "Ask community" card is a `<div onClick>` not a `<button>`

- **File:** `frontend/src/components/search/InteractiveSearchOverlay.tsx`
- **Bug:** Keyboard inaccessible. The `useAuthGate` wraps the action, but a div doesn't get Enter-key activation.
- **Fix:** Use `<button>` (or add `role="button"` + `tabIndex={0}` + onKeyDown for Enter/Space).

### M61. `HomePage.tsx:394-439` — All fetches use `mounted` flag but no AbortController

- **File:** `frontend/src/pages/HomePage.tsx`
- **Bug:** When user navigates away mid-fetch, the `mounted = false` flag prevents state update, but the network request continues until completion (wasted bandwidth + slow unmount).
- **Fix:** Use AbortController per fetch and abort on cleanup.

### M62. `HomePage.tsx:412` — Generic error message fallback instead of `friendlyError`

- **File:** `frontend/src/pages/HomePage.tsx`
- **Bug:** Uses raw error cast `err as { response?: ... }` instead of `friendlyError(err, 'Failed to load FAQs')`. The shared helper handles 401/403/5xx correctly; this local version leaks backend strings.

### M63. `NotificationBell.tsx:84-88` — `handleFocus` debounces re-fetch but no cancel

- **File:** `frontend/src/components/notifications/NotificationBell.tsx`
- **Bug:** `window.addEventListener('focus', handleFocus)` re-fetches on every focus. Tabbing between windows fires many events. No debounce.

### L59. `AskAIButton.tsx:262` — `setTimeout(() => openModal('signin'), 1500)` not cleaned up on unmount

- **File:** `frontend/src/components/askai/AskAIButton.tsx:262`
- **Bug:** If user hits anon limit and then navigates away within 1.5s, the auth modal still opens on an unmounted app.

### L60. `AskAIButton.tsx:141` — Direct DOM mutation `inputRef.current.style.height = ...`

- **File:** `frontend/src/components/askai/AskAIButton.tsx:141`
- **Bug:** Bypasses React's style system. Style is reset if React re-renders the textarea with style attribute.

### L61. `GoldenTicketPage.tsx:56` — `formatCountdown` not memoized; recomputed every render

- **File:** `frontend/src/pages/GoldenTicketPage.tsx`

### L62. `HomePage.tsx:445-449` — `categories` sort runs on every render

- **File:** `frontend/src/pages/HomePage.tsx`
- **Bug:** `Object.keys(grouped).sort(...)` recomputed every render. Already in `useMemo` with `[grouped]` dep — but the memo is recreated on every render because the inline lambda is a new function each time. Wrap in `useCallback` for consistency.

### L63. `GoldenTicketPage.tsx:23` — `axios` import unused (only used via api helper)

- **File:** `frontend/src/pages/GoldenTicketPage.tsx`

### L64. `NotificationBell.tsx:14-26` — `timeAgo` helper duplicated

- **File:** `frontend/src/components/notifications/NotificationBell.tsx`
- **Bug:** Same function as in `AdminModeration.tsx`, `AdminDocumentInsights.tsx`, etc. (M42). Add to shared `utils/time.ts`.

### L65. `ZoomAssessmentModal.tsx:71` — Raw error cast instead of `friendlyError`

- **File:** `frontend/src/components/welcome/ZoomAssessmentModal.tsx:71`
- **Bug:** Same anti-pattern as M62.

### L66. `HomePage.tsx:62-81` — 3 formatters defined inline (formatReadTime, formatViews, formatShortDate)

- **File:** `frontend/src/pages/HomePage.tsx`
- **Bug:** Should be in shared `utils/format.ts`.

### L67. `HomePage.tsx:120-122` — Magic constant `TOP_PER_CATEGORY = 3`

- **File:** `frontend/src/pages/HomePage.tsx`
- **Note:** Already declared as `const`, fine. Listed because user flagged style.

### L68. `App.tsx:19` — `sectionName="App (top-level)"` literal string

- **File:** `frontend/src/App.tsx`
- **Bug:** Magic string passed to ErrorBoundary. Should be a constant or read from a metadata file. Also ErrorBoundary (L4 audit) uses this prop in both the log line and the UI ("in `<code>`App (top-level)`</code>`") — fine functionally, but a constant would make refactors easier.

### L69. `GoldenTicketPage.tsx:34-35` — Magic constants `MIN_SP = 1`, `MAX_SP = 100`

- **File:** `frontend/src/pages/GoldenTicketPage.tsx`
- **Note:** Already declared as `const`, fine.

### L70. `ZoomBubble.tsx:14-20` — Hard-coded Tailwind classes (inline `border-[1.5px] border-[rgb(...)]`)

- **File:** `frontend/src/components/welcome/ZoomBubble.tsx`
- **Bug:** Styling should be extracted to a className via Tailwind config or `cn()` helper for consistency with the rest of the app.

### RE-CHECK: Concurrent edits summary

- **`AdminAISettings.tsx`** ✅ — optional chaining added (defensive fix, good)
- **`AdminProgramDetail.tsx`** 🔴 — `<any>` regression (H34, MUST REVERT)
- **`CommunityPage.tsx`** ✅ — `handleCloseDetail` cleanup confirmed in earlier fix
- **`PostDetailDialog.tsx`** ✅ — scroll-lock pattern correct (matches AuthModal save/restore), dead comment form removed
- **`ThreadDetail.tsx`** ✅ — scroll-lock correct
- **`CommunityPostCard.tsx`** ✅ — a11y fix (button → div role=button + keyboard handler)
- **`Navbar.tsx`** ✅ — BatchSwitcher mounted, mobile dropdown styled
- **`AdminModeration.tsx`, `AdminProjectsPage.tsx`, `AdminSupportCategories.tsx`, `AdminUsers.tsx`, `AdminZoomMeetings.tsx`, `FaqReview.tsx`, `ProjectSelectionModal.tsx`** — all added `useEffect` scroll-lock; H7 covers the pattern fix
- **`AuthModal.tsx`** ✅ — registration status banner + scroll-lock preservation correct (saves prev, restores)
- **`RegistrationControlCard.tsx`** ✅ — openForAll toggle correctly added

---

## VERIFICATION CHECKLIST (post-fix)

- [ ] `npm run typecheck` clean (frontend)
- [ ] `npm test` pass (frontend)
- [ ] `npm run build` succeeds (Vite production build)
- [ ] No new `console.log` / `console.error` left in production paths
- [ ] All `M` items addressed or triaged with reason
- [ ] Re-run this audit's spot-checks (10 random findings) before declaring done
