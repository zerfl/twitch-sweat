# Behavior Specification

This document specifies the expected behavior of the twitch-sweat application. It serves as a reference for testing and ensures that modularization maintains existing functionality.

---

## Image Generation

### Subscription Events

**Behavior:** When a user subscribes, resubs, or upgrades their subscription, the bot should generate an AI image for them.

**Events that trigger image generation:**
- `onSub` - New subscription
- `onResub` - Resubscription
- `onGiftPaidUpgrade` - User upgrades from gift to paid
- `onPrimePaidUpgrade` - User upgrades from Prime to paid
- `onSubGift` - Individual receives a gift subscription (only if gifter is known and not banned)
- `onCommunitySub` - Community gift from a user (only for the gifter, not recipients)
- `onStandardPayForward` - User pays forward a subscription
- `onCommunityPayForward` - User pays forward a community gift

**Expected flow:**
1. Event is triggered
2. Check if user is on ignore list → If yes, skip generation
3. Check if gifter is banned (for gift events) → If yes, skip generation
4. Get broadcaster's theme (if exists)
5. Get custom username meaning (if exists)
6. Select art style (random or specified)
7. Generate AI analysis with OpenAI
8. Generate DALL-E image
9. Upload to Cloudflare CDN
10. Store metadata to images.json
11. Send image URL to Twitch chat
12. Send image URL to Discord channels

**Expected output:**
- Twitch message: `Thank you @{username} for {subscribing|gifting} dnkLove This is for you: {imageUrl}`
- Discord message: `Thank you {username} for {subscribing|gifting}. Here's your sweatling: {imageUrl}`

**Error handling:**
- If user is ignored: No message, silent skip
- If gifter is banned: No message, silent skip
- If generation fails: `Thank you @{username} for {action} dnkLove Unfortunately, I was unable to generate an image for you.`

---

## Bot Commands

### User Commands

#### `!noai`
**Permission:** Any user
**Parameters:** None
**Behavior:** Adds the user to the ignore list
**Response:** `@{username} You will no longer receive AI sweatlings`

#### `!yesai`
**Permission:** Any user
**Parameters:** None
**Behavior:** Removes the user from the ignore list
**Response:** `@{username} You will now receive AI sweatlings`

#### `!myai`
**Permission:** Any user
**Parameters:** None
**Behavior:** Provides link to user's generated images
**Response:** `@{username} Check your sweatlings at https://www.curvyspiderwife.com/user/{username} or in Discord dnkLove`

#### `!getmeaning <username>`
**Permission:** Any user
**Parameters:** `username` (required)
**Behavior:** Shows the custom meaning for a username
**Response:** `@{username} {target} means '{meaning}' dnkNoted`

#### `!gettheme`
**Permission:** Any user
**Parameters:** None
**Behavior:** Shows the current theme for the broadcaster's channel
**Response (if theme exists):** `@{username} Current theme: {theme}`
**Response (if no theme):** `@{username} No theme set.`

---

### Admin/Broadcaster Commands

#### `!aisweatling <username> [style]`
**Permission:** Admin or broadcaster
**Parameters:**
- `username` (required) - Target user
- `style` (optional) - Art style keyword

**Behavior:** Generates an AI image for the specified user
**Response (if user ignored):** `@{username} {target} does not partake in ai sweatlings.`
**Response (success):** `@{username} requested generation for @{target}. Here's the sweatling: {imageUrl}`
**Response (failure):** `Sorry, {username}, I was unable to generate an image for you.`

#### `!settheme <theme>`
**Permission:** Admin or broadcaster
**Parameters:** `theme` (required, multi-word)
**Behavior:** Sets a theme for image generation on this channel
**Response:** `@{username} Theme set to: {theme}`
**Error response:** `@{username} Please provide a theme.`

#### `!deltheme`
**Permission:** Admin or broadcaster
**Parameters:** None
**Behavior:** Removes the theme for this channel
**Response:** `@{username} Theme removed.`

#### `!setmeaning <username> <meaning>`
**Permission:** Admin or broadcaster
**Parameters:**
- `username` (required)
- `meaning` (required, multi-word)

**Behavior:** Sets a custom interpretation for a username
**Response:** `@{username} Meaning for {target} set.`
**Error response:** `@{username} Please provide a username and a meaning.`

#### `!delmeaning <username>`
**Permission:** Admin or broadcaster
**Parameters:** `username` (required)
**Behavior:** Removes custom meaning for a username
**Response (success):** `@{username} Meaning for {target} removed.`
**Response (not found):** `@{username} Meaning for {target} not found.`
**Error response:** `@{username} Please provide a username.`

#### `!bangifter <username>`
**Permission:** Admin or broadcaster
**Parameters:** `username` (required)
**Behavior:** Bans a gifter from triggering image generation on this channel
**Response:** `@{username} Gifter {target} banned. Sub gifts from this user will be ignored.`
**Error response:** `@{username} Please provide a username.`

#### `!unbangifter <username>`
**Permission:** Admin or broadcaster
**Parameters:** `username` (required)
**Behavior:** Unbans a gifter
**Response (success):** `@{username} Gifter {target} unbanned.`
**Response (not found):** *(no response)*
**Error response:** `@{username} Please provide a username.`

#### `!testall <username> [count]`
**Permission:** Admin or broadcaster
**Parameters:**
- `username` (required) - Target user for testing
- `count` (optional, default: 1) - Number of images per style

**Behavior:** Generates test images for all available styles
**Response (start):** `@{username} Starting test generation for {target} with {count} image(s) per style. Total images: {total}`
**Response (per image):** `@{username} Test image for style {style}: {imageUrl}`
**Response (completion):** `@{username} Test generation {complete|cancelled}. Success: {X}, Failures: {Y}, Total: {Z}/{total}. Time taken: {seconds}s`
**Response (already running):** `@{username} A test generation is already running. Use !canceltests to stop it.`
**Error response:** `@{username} Please provide a username to test with.`

#### `!canceltests`
**Permission:** Admin or broadcaster
**Parameters:** None
**Behavior:** Cancels ongoing test generation
**Response:** `@{username} Cancelling test generation after current tasks complete...`
**Response (not running):** `@{username} No test generation is currently running.`

#### `!say <message>`
**Permission:** Admin or broadcaster
**Parameters:** `message` (required, multi-word)
**Behavior:** Makes the bot send a message to chat
**Response:** *(sends the message directly)*

#### `!uguu`
**Permission:** Admin or broadcaster
**Parameters:** None
**Behavior:** Triggers the !uguu command (for interaction with other bots)
**Response:** `!uguu`

#### `!quack`
**Permission:** Admin or broadcaster
**Parameters:** None
**Behavior:** Triggers the !quack command (for interaction with other bots)
**Response:** `!quack`

#### `!ping` (Special)
**Permission:** Only user 'partyhorst'
**Parameters:** None
**Behavior:** Responds with pong
**Response:** `@partyhorst pong`

---

## Discord Integration

### Admin DM Commands

#### `!announce <message>`
**Permission:** Discord admin only
**Parameters:** `message` (required, multi-word)
**Behavior:** Broadcasts message to all configured Discord channels
**Response (to admin):** `Announcing: {message}`
**Response (to channels):** `{message}`
**Error response:** `Please provide an announcement.`

#### `!generateimage <broadcaster> <username> [username2] [...]`
**Permission:** Discord admin only
**Parameters:**
- `broadcaster` (required) - Target broadcaster channel
- `username(s)` (required, one or more) - Users to generate images for

**Behavior:** Generates images for specified users with broadcaster's theme
**Response (per user success):** Sends image to Discord channels
**Response (per user failure):** `Unable to generate image for {username}`

### Event Notifications

**Behavior:** When images are generated from Twitch events, they are also posted to configured Discord channels.

**Message format:** `Thank you {username} for {subscribing|gifting}. Here's your sweatling: {imageUrl}`

---

## Data Persistence

### JSON Files

All data is currently stored in JSON files in the `data/` directory:

#### `tokens.json`
**Structure:** AccessToken object from @twurple/auth
**Behavior:** Automatically updated when tokens are refreshed

#### `images.json`
**Structure:**
```json
{
  "broadcaster1": {
    "user1": [
      {
        "image": "https://...",
        "analysis": "...",
        "revisedPrompt": "...",
        "date": "2024-01-01T00:00:00.000Z"
      }
    ]
  }
}
```
**Behavior:** New images are appended to user's array

#### `themes.json`
**Structure:**
```json
{
  "broadcaster1": "theme description",
  "broadcaster2": "another theme"
}
```

#### `meanings.json`
**Structure:**
```json
{
  "username1": "custom meaning",
  "username2": "another meaning"
}
```

#### `ignore.json`
**Structure:**
```json
["user1", "user2", "user3"]
```

#### `bannedGifters.json`
**Structure:**
```json
{
  "broadcaster1": ["gifter1", "gifter2"],
  "broadcaster2": ["gifter3"]
}
```

### Case Sensitivity

**All usernames are stored and compared in lowercase** to ensure case-insensitive matching.

---

## Rate Limiting

### Throttle Queues

**Messages (Twitch chat):**
- Limit: 20 messages per 30 seconds
- Behavior: Evenly distributed

**OpenAI API:**
- Limit: 500 requests per 60 seconds
- Behavior: Evenly distributed

**DALL-E API:**
- Limit: Configurable via `OPENAI_IMAGES_PER_MINUTE` environment variable
- Default: Based on OpenAI tier limits
- Behavior: Evenly distributed

### Retry Logic

**Max retries:** 3 (configurable via `MAX_RETRIES`)
**Applied to:** Image generation operations
**Behavior:**
- Retry on failure
- Log each retry attempt
- Fail after max retries exceeded

---

## Error Handling

### Token Refresh Errors

**Behavior:** Log error and continue operation
**Handler:** `authProvider.onRefreshFailure()`

### Invalid Tokens

**Behavior:** Log message and exit application
**Message:** `Invalid tokens, please check your environment variables`

### OpenAI API Errors

**Behavior:** Retry up to MAX_RETRIES times, then return error response
**User message:** `Unfortunately, I was unable to generate an image for you.`

### Cloudflare Upload Errors

**Behavior:** Return error response without retry
**User message:** `Unfortunately, I was unable to generate an image for you.`

### Discord Errors

**Behavior:** Log error and continue operation (non-blocking)
**Examples:**
- Failed to send message to channel
- Failed to login
- Failed to fetch user

---

## Logging

### Log Format

```
[YYYY-MM-DDTHH:mm:ss.sssZ] <message> <additional data>
```

### Log Destinations

- **Console:** All logs
- **File:** `data/log.txt` (all logs appended)

### Logged Events

- Connection/disconnection from Twitch
- Channel joins
- Subscription events
- Image generation steps (with unique ID tracking)
- OpenAI API calls
- Image uploads
- Errors and exceptions

---

## Environment Configuration

### Required Variables

- `TWITCH_CLIENT_ID`
- `TWITCH_CLIENT_SECRET`
- `TWITCH_CHANNELS` (comma-separated)
- `TWITCH_ACCESS_TOKEN`
- `TWITCH_REFRESH_TOKEN`
- `OPENAI_API_KEY`
- `DISCORD_BOT_TOKEN`
- `DISCORD_CHANNELS` (comma-separated channel IDs)
- `DISCORD_ADMIN_USER_ID`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_IMAGES_URL`

### Optional Variables

- `TWITCH_ADMINS` (comma-separated)
- `OPENAI_MODEL` (default: from env validation)
- `OPENAI_IMAGES_PER_MINUTE`
- `MAX_RETRIES` (default: 3)
- `CLOUDFLARE_AI_GATEWAY` (optional custom gateway URL)
- `DATABASE_URL` (currently unused, for future migration)

---

## Style Selection

### Available Styles

Styles are defined in `src/constants/styles.ts`:
- oil, watercolor, pixel, glitch, neon, baroque, expressionism, charcoal
- (and more - see DALLE_TEMPLATES array)

### Selection Behavior

1. **If style keyword provided:** Find matching template by keyword (case-insensitive)
2. **If style not found or not provided:** Select random style from all templates
3. **Style injection:** Template's `name` and `description` are injected into the DALL-E prompt

---

## Expected Performance

### Image Generation Time

**Typical:** 5-15 seconds
**Breakdown:**
- OpenAI analysis: 2-5 seconds
- DALL-E generation: 3-8 seconds
- Cloudflare upload: <1 second

### Memory Usage

**Typical:** ~150-300 MB
**Notes:** Node.js application with in-memory caching of themes, meanings, ignore lists

### Startup Time

**Typical:** <5 seconds
**Breakdown:**
- Load JSON files
- Initialize managers
- Connect to Twitch
- Connect to Discord

---

*This behavior specification serves as the contract for the application. All refactoring must maintain these behaviors unless explicitly noted and approved.*
