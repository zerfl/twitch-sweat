# Twitch-Sweat Call Tree and Data Flow Diagrams

## 1. Application Initialization Flow

```
main() [index.ts:236-936]
│
├─→ Discord Bot Setup
│   ├─→ new DiscordClient()
│   ├─→ discordBot.on(Events.InteractionCreate)
│   ├─→ discordBot.on(Events.ClientReady)
│   ├─→ discordBot.on(Events.MessageCreate)
│   │   ├─→ !announce → Broadcast to channels
│   │   └─→ !generateimage → Generate images
│   └─→ discordBot.login()
│
├─→ Twitch Authentication
│   ├─→ Load/Create tokenData from tokens.json
│   ├─→ new RefreshingAuthProvider()
│   ├─→ authProvider.onRefresh() → Save new tokens
│   ├─→ authProvider.onRefreshFailure()
│   └─→ authProvider.addUserForToken()
│
├─→ Command Registration [lines 389-846]
│   ├─→ createBotCommand('aisweatling')
│   ├─→ createBotCommand('settheme')
│   ├─→ createBotCommand('deltheme')
│   ├─→ createBotCommand('gettheme')
│   ├─→ createBotCommand('setmeaning')
│   ├─→ createBotCommand('delmeaning')
│   ├─→ createBotCommand('getmeaning')
│   ├─→ createBotCommand('noai')
│   ├─→ createBotCommand('yesai')
│   ├─→ createBotCommand('bangifter')
│   ├─→ createBotCommand('unbangifter')
│   ├─→ createBotCommand('ping')
│   ├─→ createBotCommand('say')
│   ├─→ createBotCommand('uguu')
│   ├─→ createBotCommand('quack')
│   ├─→ createBotCommand('myai')
│   ├─→ createBotCommand('testall')
│   └─→ createBotCommand('canceltests')
│
├─→ Twitch Bot Setup
│   ├─→ new Bot({ authProvider, channels, commands })
│   ├─→ twitchBot.onDisconnect()
│   ├─→ twitchBot.onConnect()
│   ├─→ twitchBot.onJoin()
│   │
│   ├─→ Event Listeners (Subscription Events)
│   │   ├─→ twitchBot.onSub()
│   │   ├─→ twitchBot.onResub()
│   │   ├─→ twitchBot.onGiftPaidUpgrade()
│   │   ├─→ twitchBot.onPrimePaidUpgrade()
│   │   ├─→ twitchBot.onStandardPayForward()
│   │   ├─→ twitchBot.onCommunityPayForward()
│   │   ├─→ twitchBot.onCommunitySub()
│   │   │   └─→ Check bannedGifterManager
│   │   └─→ twitchBot.onSubGift()
│   │       └─→ Check bannedGifterManager
│   │
│   └─→ All subscription events call:
│       handleEventAndSendImageMessage()
│
└─→ Error Handling
    ├─→ catch InvalidTokenError
    └─→ catch generic Error
```

---

## 2. Image Generation Flow (Detailed)

```
generateImage(username, userDisplayName, metadata, theme, style) [index.ts:73-164]
│
├─→ [1] Generate Unique ID
│   └─→ nanoid(14)
│
├─→ [2] Style Selection
│   ├─→ If style provided:
│   │   └─→ DALLE_TEMPLATES.find(t => t.keyword === style)
│   └─→ If no style or not found:
│       └─→ Random selection from DALLE_TEMPLATES
│
├─→ [3] Username Meaning Resolution
│   ├─→ meaningManager.getUserMeaning(username)
│   └─→ Create query message:
│       ├─→ If custom meaning: "Literal username: X, Intended meaning: Y"
│       └─→ Else: "Username: X"
│
├─→ [4] AI Analysis (Structured Output)
│   ├─→ createSystemPrompt(date, theme) [helpers.ts:87]
│   │   ├─→ Load STRUCTURED_OUTPUT_PROMPT
│   │   ├─→ Replace __DATE__ with current date
│   │   ├─→ If theme exists:
│   │   │   └─→ Inject THEME_INSTRUCTION_BLOCK with __THEME__
│   │   └─→ Clean up extra newlines
│   │
│   ├─→ Build messages array:
│   │   ├─→ system: System prompt with theme
│   │   └─→ user: Query message
│   │
│   └─→ openaiThrottle(() => {
│       └─→ openAIManager.getChatCompletion(messages, {
│           ├─→ length: 700
│           ├─→ schema: finalSchema (Zod)
│           └─→ schemaName: 'finalSchema'
│           })
│       })
│       │
│       └─→ OpenAIManager.getChatCompletion() [OpenAIManager.ts:22-91]
│           ├─→ Build OpenAI.ChatCompletionCreateParams
│           │   ├─→ model: this.model
│           │   ├─→ temperature: 1
│           │   ├─→ max_tokens: length
│           │   ├─→ store: true
│           │   ├─→ metadata: { source, product }
│           │   └─→ response_format: zodResponseFormat(schema)
│           │
│           ├─→ client.beta.chat.completions.parse()
│           └─→ Return parsed structured output
│
├─→ [5] Prepare Image Prompt
│   ├─→ Create analysisResult string
│   ├─→ Inject style into structuredOutput.step2:
│   │   ├─→ style: template.description
│   │   └─→ style_description: template.name
│   └─→ imagePrompt = JSON.stringify(structuredOutput.step2)
│
├─→ [6] DALL-E Image Generation
│   └─→ dalleThrottle(() => {
│       └─→ openAIManager.generateImage({
│           ├─→ model: 'dall-e-3'
│           ├─→ prompt: DALLE_IMAGE_PROMPT_TEMPLATE.replace('__DATA__', imagePrompt)
│           ├─→ quality: 'standard'
│           ├─→ size: '1024x1024'
│           └─→ response_format: 'url'
│           })
│       })
│       │
│       └─→ OpenAIManager.generateImage() [OpenAIManager.ts:93-95]
│           └─→ client.images.generate(params)
│
├─→ [7] Upload to Cloudflare
│   ├─→ Extract url from image.data[0].url
│   ├─→ Build updated metadata:
│   │   ├─→ ...metadata
│   │   ├─→ theme: theme ?? ''
│   │   └─→ style: style
│   │
│   └─→ cfUploader.uploadImageFromUrl(url, updatedMetadata)
│       │
│       └─→ CloudflareUploader.uploadImageFromUrl() [CloudflareUploader.ts]
│           ├─→ Generate imageId with nanoid(14)
│           ├─→ Build FormData with file and metadata
│           ├─→ axios.post() to Cloudflare API
│           └─→ Return response
│
├─→ [8] Handle Upload Result
│   ├─→ If failed:
│   │   └─→ Return { success: false, message: 'Error' }
│   │
│   └─→ If successful:
│       ├─→ Build final URL: ${CLOUDFLARE_IMAGES_URL}/${imageId}.png
│       └─→ Return {
│           ├─→ success: true
│           ├─→ message: finalUrl
│           ├─→ analysis: analysisResult
│           └─→ revisedPrompt: image.data[0].revised_prompt
│           }
│
└─→ [9] Error Handling
    └─→ Any error throws and is caught by caller
```

---

## 3. Event Handler Flow

```
handleEventAndSendImageMessage(twitchBot, discordBot, eventData) [index.ts:166-234]
│
├─→ [1] Extract Event Data
│   ├─→ broadcasterName
│   ├─→ userName
│   ├─→ userDisplayName
│   └─→ isGifting (default: false)
│
├─→ [2] Check Ignore List
│   ├─→ ignoreListManager.isUserIgnored(userName)
│   └─→ If ignored:
│       └─→ console.log() and return early
│
├─→ [3] Generate Image with Retry
│   ├─→ Build metadata:
│   │   ├─→ source: 'twitch'
│   │   ├─→ channel: broadcasterName
│   │   ├─→ target: userName
│   │   └─→ trigger: 'gifting' or 'subscribing'
│   │
│   ├─→ Get theme:
│   │   └─→ themeManager.getBroadcasterTheme(broadcasterName)
│   │
│   └─→ retryAsyncOperation(generateImage, MAX_RETRIES, ...) [helpers.ts:51-83]
│       │
│       └─→ Retry Logic:
│           ├─→ for (attempt = 0; attempt <= maxRetries; attempt++)
│           ├─→ try: await asyncOperation(...args)
│           ├─→ catch: Log error, retry if attempts remain
│           └─→ throw lastError if all attempts fail
│
├─→ [4] Handle Failure
│   ├─→ If !imageResult.success:
│   └─→ messagesThrottle(() => {
│       └─→ twitchBot.say(channel, "Unable to generate image")
│       })
│
├─→ [5] Store Image Data
│   └─→ imageDataStore.storeImageData(broadcasterName, userName, {
│       ├─→ image: imageResult.message
│       ├─→ analysis: imageResult.analysis
│       ├─→ revisedPrompt: imageResult.revisedPrompt
│       └─→ date: new Date().toISOString()
│       })
│
├─→ [6] Send to Discord
│   └─→ for each channelId in discordChannels:
│       ├─→ Get channel from cache
│       ├─→ Check if text-based and sendable
│       └─→ channel.send({
│           └─→ content: "Thank you ${userName}... ${imageUrl}"
│           })
│
└─→ [7] Send to Twitch
    └─→ messagesThrottle(() => {
        └─→ twitchBot.say(channel, "Thank you @${userName}... ${imageUrl}")
        })
```

---

## 4. Command Execution Flow

### Example: !aisweatling Command

```
User types: !aisweatling username123 watercolor

Twitch Bot Command Handler [index.ts:390-478]
│
├─→ [1] Permission Check
│   ├─→ isAdminOrBroadcaster(userName, broadcasterName, twitchAdmins)
│   │   └─→ [helpers.ts:6-11]
│   │       ├─→ Check if userName in twitchAdmins set
│   │       └─→ Check if userName === broadcasterName
│   └─→ If not authorized: return early
│
├─→ [2] Parameter Validation
│   ├─→ Check params.length > 0
│   ├─→ Extract target = params[0].replace('@', '')
│   └─→ Extract specifiedStyle = params[1] ?? null
│
├─→ [3] Ignore List Check
│   ├─→ ignoreListManager.isUserIgnored(target)
│   └─→ If ignored:
│       └─→ say("${target} does not partake in ai sweatlings")
│
├─→ [4] Generate Image
│   ├─→ Build metadata
│   ├─→ Get theme: themeManager.getBroadcasterTheme(broadcasterName)
│   └─→ retryAsyncOperation(
│       ├─→ generateImage(
│       │   ├─→ target.toLowerCase()
│       │   ├─→ target
│       │   ├─→ metadata
│       │   ├─→ theme
│       │   └─→ specifiedStyle
│       │   )
│       └─→ MAX_RETRIES
│       )
│
├─→ [5] Handle Failure
│   └─→ If !imageResult.success:
│       └─→ say("Sorry, unable to generate image")
│
├─→ [6] Store Image Data
│   └─→ imageDataStore.storeImageData(...)
│
├─→ [7] Update Discord Presence
│   └─→ discordBot.user.setActivity(...)
│
├─→ [8] Send to Discord Channels
│   └─→ for each channelId:
│       └─→ channel.send(...)
│
└─→ [9] Send to Twitch Chat
    └─→ messagesThrottle(() => say(...))
```

---

## 5. Manager Data Flow Diagrams

### 5.1 ThemeManager

```
ThemeManager [ThemeManager.ts]
│
├─→ Internal State:
│   └─→ broadcasterThemeMap: Map<string, string>
│
├─→ loadThemes() [async]
│   ├─→ fs.readFile(filePath)
│   ├─→ JSON.parse()
│   ├─→ broadcasterThemeMap.clear()
│   └─→ Fill map from JSON object
│
├─→ setTheme(broadcaster, theme) [async]
│   ├─→ broadcasterThemeMap.set(broadcaster.toLowerCase(), theme)
│   └─→ saveThemes()
│
├─→ removeTheme(broadcaster) [async]
│   ├─→ broadcasterThemeMap.delete(broadcaster.toLowerCase())
│   └─→ saveThemes()
│
├─→ getBroadcasterTheme(broadcaster)
│   └─→ broadcasterThemeMap.get(broadcaster.toLowerCase())
│
└─→ saveThemes() [async]
    ├─→ Convert map to object
    ├─→ JSON.stringify()
    └─→ fs.writeFile(filePath)
```

### 5.2 IgnoreListManager

```
IgnoreListManager [IgnoreListManager.ts]
│
├─→ Internal State:
│   └─→ ignoreList: Set<string>
│
├─→ loadIgnoreList() [async]
│   ├─→ fs.readFile(filePath)
│   ├─→ JSON.parse() → array
│   ├─→ ignoreList.clear()
│   └─→ Fill set from array
│
├─→ addToIgnoreList(userName) [async]
│   ├─→ ignoreList.add(userName.toLowerCase())
│   └─→ saveIgnoreList()
│
├─→ removeFromIgnoreList(userName) [async]
│   ├─→ ignoreList.delete(userName.toLowerCase())
│   └─→ saveIgnoreList()
│
├─→ isUserIgnored(userName)
│   └─→ ignoreList.has(userName.toLowerCase())
│
└─→ saveIgnoreList() [async]
    ├─→ Convert set to array
    ├─→ JSON.stringify()
    └─→ fs.writeFile(filePath)
```

### 5.3 MeaningManager

```
MeaningManager [MeaningManager.ts]
│
├─→ Internal State:
│   └─→ meaningMap: Map<string, string>
│
├─→ loadMeanings() [async]
│   ├─→ fs.readFile(filePath)
│   ├─→ JSON.parse()
│   ├─→ meaningMap.clear()
│   └─→ Fill map from JSON object
│
├─→ setMeaning(userName, meaning) [async]
│   ├─→ meaningMap.set(userName.toLowerCase(), meaning)
│   └─→ saveMeanings()
│
├─→ removeMeaning(userName) [async]
│   ├─→ deleted = meaningMap.delete(userName.toLowerCase())
│   └─→ If deleted: saveMeanings()
│
├─→ getUserMeaning(userName)
│   ├─→ Get from meaningMap
│   └─→ If not found: return userName (default)
│
└─→ saveMeanings() [async]
    ├─→ Convert map to object
    ├─→ JSON.stringify()
    └─→ fs.writeFile(filePath)
```

### 5.4 BannedGifterManager

```
BannedGifterManager [BannedGifterManager.ts]
│
├─→ Internal State:
│   └─→ broadcasterBannedGiftersMap: Map<string, Set<string>>
│       └─→ Maps broadcaster → Set of banned gifter usernames
│
├─→ loadBannedGifters() [async]
│   ├─→ fs.readFile(filePath)
│   ├─→ JSON.parse() → Record<string, string[]>
│   ├─→ broadcasterBannedGiftersMap.clear()
│   └─→ For each broadcaster:
│       └─→ Create Set from array and add to map
│
├─→ addBannedGifter(broadcaster, gifter) [async]
│   ├─→ Get or create Set for broadcaster
│   ├─→ Set.add(gifter.toLowerCase())
│   └─→ saveBannedGifters()
│
├─→ removeBannedGifter(broadcaster, gifter) [async]
│   ├─→ Get Set for broadcaster
│   ├─→ deleted = Set.delete(gifter.toLowerCase())
│   └─→ If deleted: saveBannedGifters()
│
├─→ isGifterBanned(broadcaster, gifter)
│   ├─→ Get Set for broadcaster
│   └─→ Return Set.has(gifter.toLowerCase())
│
├─→ getMap()
│   └─→ Return broadcasterBannedGiftersMap.entries()
│
└─→ saveBannedGifters() [async]
    ├─→ Convert Map<string, Set<string>> to Record<string, string[]>
    ├─→ JSON.stringify()
    └─→ fs.writeFile(filePath)
```

### 5.5 ImageDataStore

```
ImageDataStore [ImageDataStore.ts]
│
├─→ Internal State:
│   └─→ imageData: Map<string, Map<string, SingleImage[]>>
│       └─→ Maps broadcaster → userName → array of images
│
├─→ storeImageData(broadcaster, userName, imageData) [async]
│   ├─→ Get or create Map for broadcaster
│   ├─→ Get or create array for userName
│   ├─→ Push imageData to array
│   └─→ saveImageData()
│
├─→ getImageData(broadcaster, userName)
│   ├─→ Get Map for broadcaster
│   ├─→ Get array for userName
│   └─→ Return array or empty array
│
└─→ saveImageData() [async]
    ├─→ Convert nested Map to nested Record
    ├─→ JSON.stringify()
    └─→ fs.writeFile(filePath)
    └─→ ⚠️ TODO: Database migration needed (inefficient)
```

---

## 6. Throttle Queue Flow

```
Throttled Operations
│
├─→ messagesThrottle(fn) [20 per 30s]
│   └─→ Used for:
│       ├─→ twitchBot.say() calls
│       └─→ Twitch chat responses
│
├─→ openaiThrottle(fn) [500 per 60s]
│   └─→ Used for:
│       └─→ openAIManager.getChatCompletion()
│
└─→ dalleThrottle(fn) [DALLE_THROTTLE_LIMIT per DALLE_THROTTLE_INTERVAL_MS]
    └─→ Used for:
        └─→ openAIManager.generateImage()

Implementation:
throttledQueue(limit, interval, evenly)
├─→ Creates a queue
├─→ Limits calls to `limit` per `interval` ms
├─→ If evenly=true: Spaces calls evenly
└─→ Returns function that wraps async operations
```

---

## 7. Data Dependencies Graph

```
index.ts (Main Entry)
│
├─→ Depends on:
│   ├─→ env.ts (Environment variables)
│   ├─→ constants/config.ts (Throttle limits)
│   ├─→ constants/prompts.ts (AI prompts)
│   ├─→ constants/styles.ts (DALL-E templates)
│   ├─→ schemas/imageSchemas.ts (Zod schemas)
│   │
│   ├─→ managers/
│   │   ├─→ ThemeManager
│   │   ├─→ MeaningManager
│   │   ├─→ IgnoreListManager
│   │   ├─→ BannedGifterManager
│   │   └─→ ImageDataStore
│   │
│   └─→ utils/
│       ├─→ OpenAIManager
│       ├─→ CloudflareUploader
│       └─→ helpers (isAdminOrBroadcaster, retryAsyncOperation, etc.)
│
├─→ External Dependencies:
│   ├─→ @twurple/easy-bot (Bot, createBotCommand)
│   ├─→ @twurple/auth (RefreshingAuthProvider)
│   ├─→ discord.js (DiscordClient, Events)
│   ├─→ throttled-queue
│   └─→ nanoid
│
└─→ File System:
    └─→ data/
        ├─→ tokens.json (Twitch OAuth)
        ├─→ images.json (Image metadata)
        ├─→ meanings.json (Username meanings)
        ├─→ themes.json (Broadcaster themes)
        ├─→ ignore.json (User opt-outs)
        ├─→ bannedGifters.json (Banned gifters)
        └─→ log.txt (Application logs)
```

---

## 8. Cross-Module Communication

### Current Architecture (Tightly Coupled)
```
Commands → Directly access global variables:
    ├─→ themeManager
    ├─→ meaningManager
    ├─→ ignoreListManager
    ├─→ bannedGifterManager
    ├─→ imageDataStore
    ├─→ openAIManager
    ├─→ cfUploader
    └─→ twitchBot, discordBot, messagesThrottle

Problem: High coupling, hard to test, no dependency injection
```

### Proposed Architecture (Loosely Coupled)
```
Commands → CommandHandler
    ↓
CommandHandler → Services (via interfaces)
    ├─→ IStorageService (Theme, Meaning, Ignore, etc.)
    ├─→ IAIService (OpenAI)
    ├─→ IUploadService (Cloudflare)
    ├─→ IMessagingService (Twitch, Discord)
    └─→ Injected via constructor

Benefits: Low coupling, easy to test, swappable implementations
```

---

## 9. Initialization Sequence

```
START: node --import tsx src/index.ts
│
├─→ [1] Import dotenv config
├─→ [2] Import dependencies
├─→ [3] Module-level initialization [lines 938-960]:
│   ├─→ getAppRootDir()
│   ├─→ Build file paths (tokens, images, meanings, etc.)
│   ├─→ Create service instances:
│   │   ├─→ openAIManager
│   │   ├─→ cfUploader
│   │   ├─→ ignoreListManager
│   │   ├─→ themeManager
│   │   ├─→ meaningManager
│   │   ├─→ bannedGifterManager
│   │   └─→ imageDataStore
│   └─→ Create throttle queues
│
├─→ [4] Setup logging [lines 963-969]:
│   └─→ Override console.log to append to log.txt
│
├─→ [5] Initialize data files [lines 971-979]:
│   ├─→ ensureFileExists() for all JSON files
│   ├─→ ignoreListManager.loadIgnoreList()
│   ├─→ themeManager.loadThemes()
│   ├─→ meaningManager.loadMeanings()
│   └─→ bannedGifterManager.loadBannedGifters()
│
├─→ [6] Log configuration [lines 985-995]
│
├─→ [7] Call main() [line 997]:
│   ├─→ Setup Discord bot
│   ├─→ Setup Twitch auth
│   ├─→ Register commands
│   ├─→ Setup Twitch bot
│   ├─→ Register event handlers
│   └─→ Connect bots
│
└─→ [8] Error handling [lines 998-1002]
```

---

## 10. Error Flow

```
Error Handling Patterns:

1. Retry with Backoff:
   retryAsyncOperation(fn, MAX_RETRIES)
   ├─→ Attempt 1: try
   ├─→ Attempt 2: catch, log, retry
   ├─→ Attempt 3: catch, log, retry
   └─→ Final: throw lastError

2. Silent Failure (Managers):
   loadThemes()
   ├─→ try: fs.readFile()
   └─→ catch: console.error(), continue with empty data

3. Graceful Degradation (Image Generation):
   handleEventAndSendImageMessage()
   ├─→ try: generateImage()
   └─→ catch: Send "unable to generate" message

4. Top-Level Handlers:
   main()
   ├─→ try: Bot initialization
   └─→ catch InvalidTokenError: Log and exit
       catch Error: console.trace()

Issues:
- No structured logging (just console.log)
- No error categorization
- No monitoring/alerting
- No error recovery strategies
```

---

## 11. Async Flow

```
All async operations follow this pattern:

User Action (Sub, Gift, Command)
    ↓ [Event/Command Handler]
    ↓
Throttle Queue (messagesThrottle, openaiThrottle, dalleThrottle)
    ↓ [Rate Limiting]
    ↓
Retry Logic (retryAsyncOperation with MAX_RETRIES)
    ↓ [Error Recovery]
    ↓
Core Operation (generateImage, saveData, etc.)
    ↓ [Business Logic]
    ↓
Result (Success/Failure)
    ↓ [Response Handling]
    ↓
User Feedback (Twitch chat, Discord message)

All operations are async/await based.
No callbacks, all promises.
```

---

*This document complements MODULARIZATION_ANALYSIS.md and provides detailed call trees for understanding the current application flow.*

---

## 📝 Real-time Progress Tracking

**⚠️ THIS SECTION TRACKS LIVE IMPLEMENTATION PROGRESS**

This document is updated in real-time as implementation progresses. New call trees, updated data flows, and refactored patterns are documented below. This section should always remain at the end of the document.

### Refactored Call Trees

*No refactored call trees yet. Original call trees documented above.*

### New Data Flows

*No new data flows yet*

### Pattern Changes

*No pattern changes yet*

---
**Note:** This real-time tracking section should always be the last section of this document. When adding updates, append them in the appropriate subsection above this note.
