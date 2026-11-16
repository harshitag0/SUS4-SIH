/**
 * Basic assistant: used when no Claude credentials are configured (or the API is unreachable).
 * Answers only a few question types, straight from the farmer's own data. Never invents advice.
 */
const T = {
  en: {
    hi: "Hello {name}! I'm your AgriLink helper. Ask me what to do today, about the weather, your harvest or your mango quality.",
    todo0: "Nothing pending right now. Your orchard looks on track. Keep sending photos at each stage.",
    todo: "You have {n} things to do. Most urgent: {first}, by {date}.",
    wait: "A farmer doctor is checking one problem first. I'll tell you the steps once it's approved.",
    weather: "Next 2 days: about {rain} mm rain, wind up to {wind} km/h, up to {temp}°C.",
    weatherBad: " Rain is coming, so keep sprays and harvest for dry hours.",
    harvest: "Harvest: {state}.",
    harvest0: "No harvest dates yet. They appear once you have an agreement.",
    quality: "Last check: blemishes {defect}%, colour {colour}.",
    quality0: "No quality check yet. Send a photo from Crop stages.",
    help: "For any disease, pest or spray, your farmer doctor should confirm first. Open the problem and tap 'Ask for help'.",
    unknown: "I'm here to help! Ask me about today's work, the weather, your harvest, mango quality or prices.",
  },
  hi: {
    hi: "नमस्ते {name}! मैं आपका AgriLink साथी हूँ। आज क्या करना है, मौसम, कटाई या आम की गुणवत्ता के बारे में पूछिए।",
    todo0: "अभी कोई काम बाकी नहीं है। बाग़ ठीक चल रहा है। हर चरण पर फ़ोटो भेजते रहें।",
    todo: "आपके {n} काम बाकी हैं। सबसे ज़रूरी: {first}, {date} तक।",
    wait: "एक समस्या को पहले फ़ार्मर डॉक्टर जाँच रहे हैं। मंज़ूरी मिलते ही मैं कदम बताऊँगा।",
    weather: "अगले 2 दिन: लगभग {rain} मिमी बारिश, हवा {wind} किमी/घंटा तक, तापमान {temp}°C तक।",
    weatherBad: " बारिश आ रही है, छिड़काव और तुड़ाई सूखे समय में करें।",
    harvest: "कटाई: {state}।",
    harvest0: "अभी कटाई की तारीख नहीं है। अनुबंध होने पर दिखेगी।",
    quality: "पिछली जाँच: दाग़ {defect}%, रंग {colour}।",
    quality0: "अभी कोई गुणवत्ता जाँच नहीं हुई। फ़सल चरण से फ़ोटो भेजें।",
    help: "किसी भी रोग, कीट या दवा के लिए पहले फ़ार्मर डॉक्टर की पुष्टि ज़रूरी है। समस्या खोलें और 'मदद माँगें' दबाएँ।",
    unknown: "मैं आपकी मदद के लिए हूँ! आज का काम, मौसम, कटाई, आम की गुणवत्ता या भाव के बारे में पूछिए।",
  },
  mr: {
    hi: "नमस्कार {name}! मी तुमचा AgriLink मित्र. आज काय करायचं, हवामान, काढणी किंवा आंब्याच्या दर्जाबद्दल विचारा.",
    todo0: "आत्ता काहीही बाकी नाही. बाग व्यवस्थित आहे. प्रत्येक टप्प्यावर फोटो पाठवत रहा.",
    todo: "तुमची {n} कामं बाकी आहेत. सर्वात महत्त्वाचं: {first}, {date} पर्यंत.",
    wait: "एक समस्या आधी फार्मर डॉक्टर तपासत आहेत. मंजुरी मिळाल्यावर मी पायऱ्या सांगेन.",
    weather: "पुढचे 2 दिवस: सुमारे {rain} मिमी पाऊस, वारा {wind} किमी/तास पर्यंत, तापमान {temp}°C पर्यंत.",
    weatherBad: " पाऊस येतोय, फवारणी आणि काढणी कोरड्या वेळी करा.",
    harvest: "काढणी: {state}.",
    harvest0: "अजून काढणीची तारीख नाही. करार झाल्यावर दिसेल.",
    quality: "मागची तपासणी: डाग {defect}%, रंग {colour}.",
    quality0: "अजून दर्जा तपासणी नाही. पीक टप्प्यातून फोटो पाठवा.",
    help: "कोणताही रोग, कीड किंवा फवारणीसाठी आधी फार्मर डॉक्टरची खात्री हवी. समस्या उघडा आणि 'मदत मागा' दाबा.",
    unknown: "मी तुमच्या मदतीसाठी आहे! आजचं काम, हवामान, काढणी, आंब्याचा दर्जा किंवा भाव याबद्दल विचारा.",
  },
  gu: {
    hi: "નમસ્તે {name}! હું તમારો AgriLink સાથી છું. આજે શું કરવું, હવામાન, લણણી કે કેરીની ગુણવત્તા વિશે પૂછો.",
    todo0: "હમણાં કંઈ બાકી નથી. વાડી બરાબર ચાલે છે.",
    todo: "તમારા {n} કામ બાકી છે. સૌથી જરૂરી: {first}, {date} સુધી.",
    wait: "એક સમસ્યા ફાર્મર ડૉક્ટર પહેલાં તપાસે છે.",
    weather: "આગામી 2 દિવસ: આશરે {rain} મિમી વરસાદ, પવન {wind} કિમી/કલાક સુધી, {temp}°C સુધી.",
    weatherBad: " વરસાદ આવે છે, છંટકાવ અને લણણી સૂકા સમયે કરો.",
    harvest: "લણણી: {state}.",
    harvest0: "હજી લણણીની તારીખ નથી.",
    quality: "છેલ્લી તપાસ: ડાઘ {defect}%, રંગ {colour}.",
    quality0: "હજી ગુણવત્તા તપાસ નથી. ફોટો મોકલો.",
    help: "રોગ, જીવાત કે દવા માટે પહેલાં ફાર્મર ડૉક્ટરની ખાતરી જરૂરી છે. 'મદદ માગો' દબાવો.",
    unknown: "હું તમારી મદદ માટે છું! આજનું કામ, હવામાન, લણણી, કેરીની ગુણવત્તા કે ભાવ વિશે પૂછો.",
  },
  ta: {
    hi: "வணக்கம் {name}! நான் உங்கள் AgriLink உதவியாளர். இன்று என்ன செய்வது, வானிலை, அறுவடை அல்லது மாம்பழ தரம் பற்றி கேளுங்கள்.",
    todo0: "இப்போது எந்த வேலையும் நிலுவையில் இல்லை.",
    todo: "உங்களுக்கு {n} வேலைகள் உள்ளன. முதலில்: {first}, {date} க்குள்.",
    wait: "ஒரு பிரச்சனையை விவசாய மருத்துவர் முதலில் சரிபார்க்கிறார்.",
    weather: "அடுத்த 2 நாட்கள்: சுமார் {rain} மிமீ மழை, காற்று {wind} கிமீ/மணி வரை, {temp}°C வரை.",
    weatherBad: " மழை வருகிறது, தெளிப்பு மற்றும் அறுவடையை உலர்ந்த நேரத்தில் செய்யுங்கள்.",
    harvest: "அறுவடை: {state}.",
    harvest0: "இன்னும் அறுவடை தேதி இல்லை.",
    quality: "கடைசி சோதனை: கறை {defect}%, நிறம் {colour}.",
    quality0: "இன்னும் தர சோதனை இல்லை. புகைப்படம் அனுப்புங்கள்.",
    help: "நோய், பூச்சி அல்லது மருந்துக்கு முதலில் விவசாய மருத்துவர் உறுதி செய்ய வேண்டும். 'உதவி கேள்' அழுத்துங்கள்.",
    unknown: "உதவ நான் இருக்கிறேன்! இன்றைய வேலை, வானிலை, அறுவடை, மாம்பழ தரம் அல்லது விலை பற்றி கேளுங்கள்.",
  },
  te: {
    hi: "నమస్తే {name}! నేను మీ AgriLink సహాయకుడిని. ఈ రోజు ఏం చేయాలి, వాతావరణం, కోత లేదా మామిడి నాణ్యత గురించి అడగండి.",
    todo0: "ప్రస్తుతం పెండింగ్ పనులు లేవు.",
    todo: "మీకు {n} పనులు ఉన్నాయి. ముందుగా: {first}, {date} లోపు.",
    wait: "ఒక సమస్యను రైతు డాక్టర్ ముందుగా పరిశీలిస్తున్నారు.",
    weather: "రాబోయే 2 రోజులు: సుమారు {rain} మి.మీ వర్షం, గాలి {wind} కి.మీ/గం వరకు, {temp}°C వరకు.",
    weatherBad: " వర్షం వస్తోంది, పిచికారీ మరియు కోత పొడి సమయంలో చేయండి.",
    harvest: "కోత: {state}.",
    harvest0: "ఇంకా కోత తేదీ లేదు.",
    quality: "చివరి తనిఖీ: మచ్చలు {defect}%, రంగు {colour}.",
    quality0: "ఇంకా నాణ్యత తనిఖీ లేదు. ఫోటో పంపండి.",
    help: "వ్యాధి, పురుగు లేదా మందు కోసం ముందుగా రైతు డాక్టర్ నిర్ధారించాలి. 'సహాయం అడగండి' నొక్కండి.",
    unknown: "సహాయం చేయడానికి నేను ఉన్నాను! ఈ రోజు పని, వాతావరణం, కోత, మామిడి నాణ్యత లేదా ధర గురించి అడగండి.",
  },
  kn: {
    hi: "ನಮಸ್ಕಾರ {name}! ನಾನು ನಿಮ್ಮ AgriLink ಸಹಾಯಕ. ಇಂದು ಏನು ಮಾಡಬೇಕು, ಹವಾಮಾನ, ಕೊಯ್ಲು ಅಥವಾ ಮಾವಿನ ಗುಣಮಟ್ಟದ ಬಗ್ಗೆ ಕೇಳಿ.",
    todo0: "ಈಗ ಯಾವುದೇ ಕೆಲಸ ಬಾಕಿ ಇಲ್ಲ.",
    todo: "ನಿಮಗೆ {n} ಕೆಲಸಗಳಿವೆ. ಮೊದಲು: {first}, {date} ಒಳಗೆ.",
    wait: "ಒಂದು ಸಮಸ್ಯೆಯನ್ನು ರೈತ ವೈದ್ಯರು ಮೊದಲು ಪರಿಶೀಲಿಸುತ್ತಿದ್ದಾರೆ.",
    weather: "ಮುಂದಿನ 2 ದಿನ: ಸುಮಾರು {rain} ಮಿಮೀ ಮಳೆ, ಗಾಳಿ {wind} ಕಿಮೀ/ಗಂ ವರೆಗೆ, {temp}°C ವರೆಗೆ.",
    weatherBad: " ಮಳೆ ಬರುತ್ತಿದೆ, ಸಿಂಪಡಣೆ ಮತ್ತು ಕೊಯ್ಲನ್ನು ಒಣ ಸಮಯದಲ್ಲಿ ಮಾಡಿ.",
    harvest: "ಕೊಯ್ಲು: {state}.",
    harvest0: "ಇನ್ನೂ ಕೊಯ್ಲು ದಿನಾಂಕ ಇಲ್ಲ.",
    quality: "ಕೊನೆಯ ಪರಿಶೀಲನೆ: ಕಲೆ {defect}%, ಬಣ್ಣ {colour}.",
    quality0: "ಇನ್ನೂ ಗುಣಮಟ್ಟ ಪರಿಶೀಲನೆ ಇಲ್ಲ. ಫೋಟೋ ಕಳುಹಿಸಿ.",
    help: "ರೋಗ, ಕೀಟ ಅಥವಾ ಔಷಧಿಗೆ ಮೊದಲು ರೈತ ವೈದ್ಯರು ದೃಢಪಡಿಸಬೇಕು. 'ಸಹಾಯ ಕೇಳಿ' ಒತ್ತಿ.",
    unknown: "ಸಹಾಯ ಮಾಡಲು ನಾನು ಇದ್ದೇನೆ! ಇಂದಿನ ಕೆಲಸ, ಹವಾಮಾನ, ಕೊಯ್ಲು, ಮಾವಿನ ಗುಣಮಟ್ಟ ಅಥವಾ ಬೆಲೆ ಬಗ್ಗೆ ಕೇಳಿ.",
  },
};

// Keywords per intent, across scripts (English words also work in every language).
const INTENTS = [
  ["help", /disease|pest|spray|insect|fly|fungus|medicine|bimari|beemari|rog|keeda|kida|keede|dawai|dawa|chhidkav|favarni|रोग|कीट|कीड|दवा|फवार|छिड़क|रोग|જીવાત|દવા|பூச்சி|நோய்|మందు|పురుగు|ವ್ಯಾಧಿ|ಕೀಟ|ಔಷಧ/i],
  ["weather", /weather|rain|wind|temp|mausam|mosam|vatavaran|vaatavaran|barish|baarish|baris|paus|paaus|havaman|hawaman|garmi|thand|मौसम|बारिश|पाऊस|हवामान|વરસાદ|હવામાન|மழை|வானிலை|వర్షం|వాతావరణం|ಮಳೆ|ಹವಾಮಾನ/i],
  ["harvest", /harvest|picking|katai|kataai|todai|tudai|kadhni|kaadhni|कटाई|तुड़ाई|काढणी|तोड|લણણી|அறுவடை|కోత|ಕೊಯ್ಲು/i],
  ["quality", /quality|grade|colou?r|blemish|spot|gunvatta|dag|daag|darja|गुणवत्ता|ग्रेड|दर्जा|डाग|दाग़|ગુણવત્તા|தரம்|నాణ్యత|ಗುಣಮಟ್ಟ/i],
  ["todo", /todo|to do|today|task|work|what should|next|kya karu|kya karun|kya karna|kaam|kam karu|kay karu|kaay karu|kaam kay|aaj kya|काम|आज|क्या कर|काय कर|કામ|આજે|வேலை|இன்று|పని|ఈ రోజు|ಕೆಲಸ|ಇಂದು/i],
  ["hi", /^(hi|hello|hey|namaste|नमस्ते|नमस्कार|हाय|નમસ્તે|வணக்கம்|నమస్తే|ನಮಸ್ಕಾರ)\b/i],
];

// Extra phrases (en/hi/mr full; other languages fall back to English for these lines).
const X = {
  en: {
    steps: "Here's how:", summary: "Quick update for you:", tasksN: "{n} tasks pending", noTasks: "no tasks pending",
    thanks: "You're welcome! I'm here any time. Good luck with the orchard.", who: "I'm Mitra, your AgriLink helper. I know your advice, crop stages, quality checks, harvest dates and weather.",
    how: "I'm doing well, thank you! How is the orchard today?", more: "You can also ask: what to do today, rain, harvest date, quality, price or certificates.",
    price: "Prices change daily. Open 'Price' in the menu to see the expected price for your grade, and 'Offers' for buyer offers.",
    cert: "After your lot is collected and checked, a quality certificate with a QR code is made automatically. See it under 'Certificates'.",
    stage: "Your crop: {crops}. Send photos at each stage from 'Crop stages' so the farmer doctor can approve them.", stage0: "You haven't added a crop yet. Add one in 'Crop stages' and send photos at each stage.",
    visit: "Next farmer doctor visit: {date}.", visit0: "No farmer doctor visit is booked yet.",
    match: "About {problem}:", doneN: "You have finished {n} tasks. Well done!",
    gap: "Your buyer wants grade {grade}. Right now {n} checks don't meet it yet.", gap0: "Your last checks meet the buyer's standard. Keep it up!",
    generic: "I didn't fully get that. In short: {summary}",
  },
  hi: {
    steps: "ऐसे करें:", summary: "आपके लिए छोटा अपडेट:", tasksN: "{n} काम बाकी", noTasks: "कोई काम बाकी नहीं",
    thanks: "आपका स्वागत है! मैं हमेशा यहाँ हूँ। बाग़ के लिए शुभकामनाएँ।", who: "मैं मित्र हूँ, आपका AgriLink साथी। मुझे आपकी सलाह, फ़सल चरण, गुणवत्ता जाँच, कटाई और मौसम की जानकारी है।",
    how: "मैं ठीक हूँ, धन्यवाद! आज बाग़ कैसा है?", more: "आप यह भी पूछ सकते हैं: आज क्या करूँ, बारिश, कटाई, गुणवत्ता, भाव या प्रमाणपत्र।",
    price: "भाव रोज़ बदलते हैं। अपने ग्रेड का अनुमानित भाव 'भाव' में और खरीदारों के ऑफ़र 'ऑफ़र' में देखें।",
    cert: "लॉट जमा होने और जाँच के बाद QR कोड वाला गुणवत्ता प्रमाणपत्र अपने आप बनता है। 'प्रमाणपत्र' में देखें।",
    stage: "आपकी फ़सल: {crops}। हर चरण पर 'फ़सल चरण' से फ़ोटो भेजें ताकि फ़ार्मर डॉक्टर मंज़ूरी दें।", stage0: "अभी कोई फ़सल नहीं जोड़ी। 'फ़सल चरण' में जोड़ें और हर चरण पर फ़ोटो भेजें।",
    visit: "अगली फ़ार्मर डॉक्टर विज़िट: {date}।", visit0: "अभी कोई डॉक्टर विज़िट तय नहीं है।",
    match: "{problem} के बारे में:", doneN: "आपने {n} काम पूरे किए। शाबाश!",
    gap: "खरीदार को ग्रेड {grade} चाहिए। अभी {n} जाँचें उस स्तर पर नहीं हैं।", gap0: "आपकी पिछली जाँचें खरीदार के मानक पर हैं। ऐसे ही रखें!",
    generic: "मैं पूरी तरह समझ नहीं पाया। संक्षेप में: {summary}",
  },
  mr: {
    steps: "असं करा:", summary: "तुमच्यासाठी छोटा अपडेट:", tasksN: "{n} कामं बाकी", noTasks: "कोणतंही काम बाकी नाही",
    thanks: "स्वागत आहे! मी कधीही इथे आहे. बागेसाठी शुभेच्छा.", who: "मी मित्र, तुमचा AgriLink साथी. मला तुमचा सल्ला, पीक टप्पे, दर्जा तपासणी, काढणी आणि हवामान माहीत आहे.",
    how: "मी छान आहे, धन्यवाद! आज बाग कशी आहे?", more: "तुम्ही हेही विचारू शकता: आज काय करू, पाऊस, काढणी, दर्जा, भाव किंवा प्रमाणपत्र.",
    price: "भाव रोज बदलतात. तुमच्या ग्रेडचा अंदाजे भाव 'भाव' मध्ये आणि खरेदीदारांच्या ऑफर 'ऑफर' मध्ये पाहा.",
    cert: "लॉट जमा होऊन तपासणी झाल्यावर QR कोड असलेलं दर्जा प्रमाणपत्र आपोआप तयार होतं. 'प्रमाणपत्र' मध्ये पाहा.",
    stage: "तुमचं पीक: {crops}. प्रत्येक टप्प्यावर 'पीक टप्पे' मधून फोटो पाठवा म्हणजे फार्मर डॉक्टर मंजुरी देतील.", stage0: "अजून पीक जोडलं नाही. 'पीक टप्पे' मध्ये जोडा आणि प्रत्येक टप्प्यावर फोटो पाठवा.",
    visit: "पुढची फार्मर डॉक्टर भेट: {date}.", visit0: "अजून डॉक्टर भेट ठरलेली नाही.",
    match: "{problem} बद्दल:", doneN: "तुम्ही {n} कामं पूर्ण केली. छान!",
    gap: "खरेदीदाराला ग्रेड {grade} हवा. सध्या {n} तपासण्या त्या पातळीवर नाहीत.", gap0: "तुमच्या मागच्या तपासण्या खरेदीदाराच्या मानकानुसार आहेत. असंच ठेवा!",
    generic: "मला नीट समजलं नाही. थोडक्यात: {summary}",
  },
};

const MORE_INTENTS = [
  ["thanks", /thank|dhanyavad|dhanyawad|shukriya|धन्यवाद|शुक्रिया|આભાર|நன்றி|ధన్యవాద|ಧನ್ಯವಾದ/i],
  ["who", /who are you|your name|what can you|आप कौन|तुम कौन|तू कोण|तुम्ही कोण/i],
  ["how", /how are you|कैसे हो|कैसे हैं|कसा आहेस|कसे आहात/i],
  ["price", /price|rate|bhav|bhaav|daam|dam|kimat|keemat|paisa|paise|money|sell|offer|भाव|दाम|कीमत|किंमत|ऑफ़र|ऑफर/i],
  ["cert", /certif|qr|trace|प्रमाणपत्र|सर्टिफिकेट/i],
  ["stage", /stage|crop|photo|flower|चरण|फ़सल|फसल|पीक|टप्प|फोटो|फ़ोटो|मोहर/i],
  ["visit", /visit|doctor|inspection|डॉक्टर|विज़िट|भेट|तपासणी/i],
  ["gap", /buyer|standard|requirement|खरीदार|खरेदीदार|मानक/i],
  ["done", /finished|completed|पूरा किया|पूर्ण केल/i],
  ["summary", /status|update|summary|overview|स्थिति|अपडेट|स्थिती/i],
];

const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => (v[k] ?? ""));
const day = (d) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—");
const words = (s) => (s || "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);
const STOP = new Set(["the", "and", "what", "about", "how", "should", "today", "tell", "with", "for", "you", "your", "this", "that", "करें", "करा"]);

/** Advice item whose problem/action shares a meaningful word with the question. */
function matchItem(text, items) {
  const q = new Set(words(text).filter((w) => !STOP.has(w)));
  let best = null, score = 0;
  for (const i of items) {
    const sc = new Set(words(`${i.problem} ${i.action || ""}`).filter((w) => q.has(w))).size;
    if (sc > score) { best = i; score = sc; }
  }
  return best;
}

function itemAnswer(i, t, x) {
  if (i.awaitingApproval) return `${fill(x.match, { problem: i.problem })} ${t.wait}`;
  const steps = (i.steps || []).slice(0, 4).map((s, n) => `${n + 1}. ${s}`).join("\n");
  return `${fill(x.match, { problem: i.problem })} ${i.action || ""}${i.dueDate ? ` (${day(i.dueDate)})` : ""}` + (steps ? `\n${x.steps}\n${steps}` : "") + (i.why ? `\n${i.why}` : "");
}

function summary(ctx, t, x) {
  const todo = ctx.todo || [], parts = [todo.length ? `${fill(x.tasksN, { n: todo.length })}: ${todo[0].problem}.` : `${x.noTasks}.`];
  if (ctx.weather) parts.push(fill(t.weather, { rain: ctx.weather.rain_mm_48h, wind: Math.round(ctx.weather.wind_kmh), temp: Math.round(ctx.weather.temp_c) }));
  if (ctx.latest?.defect != null) parts.push(fill(t.quality, { defect: ctx.latest.defect, colour: ctx.latest.colour ?? "—" }));
  else if (ctx.latest?.doctorGrade) parts.push(`${ctx.lang === "en" ? "Farmer doctor grade" : "Grade"}: ${ctx.latest.doctorGrade}.`);
  if (ctx.harvest?.length) parts.push(fill(t.harvest, { state: ctx.harvest.map((h) => h.state.replace(/_/g, " ")).join(", ") }));
  return parts.join(" ");
}

/** Answers every topic the question mentions, using the farmer's own data; a named problem gets its steps. */
/** Language the farmer actually wrote in (script, or common romanized Hindi/Marathi words); falls back to their setting. */
export function detectLang(text, fallback = "en") {
  const q = text || "";
  if (/[஀-௿]/.test(q)) return "ta";
  if (/[ఀ-౿]/.test(q)) return "te";
  if (/[ಀ-೿]/.test(q)) return "kn";
  if (/[઀-૿]/.test(q)) return "gu";
  if (/[ऀ-ॿ]/.test(q)) return /(आहे|काय|करू|मला|तुम्ही|नाही|पाऊस|काढणी|सांगा)/.test(q) ? "mr" : fallback === "mr" ? "mr" : "hi";
  const w = ` ${q.toLowerCase().replace(/[^a-z\s]/g, " ")} `;
  const has = (list) => list.some((x) => w.includes(` ${x} `));
  if (has(["aahe", "ahe", "kay", "kaay", "mala", "tumhi", "paus", "kadhni", "sanga", "kiti", "karu ka", "yeil"])) return "mr";
  if (has(["mujhe", "mujhko", "kya", "hai", "hain", "aaj", "bataiye", "batao", "kaise", "kab", "mera", "meri", "mere", "karu", "karun", "mausam", "vatavaran", "baarish", "barish", "kitna", "kaun", "ke", "mein", "ki"])) return "hi";
  if (has(["what", "when", "how", "will", "is", "my", "the", "today", "weather", "price", "rain", "hello", "hi"])) return "en";
  return fallback;
}

export function basicReply(text, ctx) {
  ctx = { ...ctx, lang: detectLang(text, ctx.lang) };
  const t = T[ctx.lang] || T.en, x = { ...X.en, ...(X[ctx.lang] || {}) };
  const q = text || "", todo = ctx.todo || [], out = [];
  let found = [...INTENTS, ...MORE_INTENTS].filter(([, re]) => re.test(q)).map(([k]) => k);
  // "today" in "will it rain today?" is about the weather, not the task list
  if (found.some((k) => ["weather", "harvest", "quality", "price", "visit"].includes(k))) found = found.filter((k) => k !== "todo");
  const m = matchItem(q, todo);
  if (m) out.push(itemAnswer(m, t, x));
  for (const k of found) {
    switch (k) {
      case "hi": out.push(fill(t.hi, { name: ctx.name || "" })); break;
      case "thanks": out.push(x.thanks); break;
      case "who": out.push(x.who); break;
      case "how": out.push(x.how); break;
      case "todo": {
        const ready = todo.filter((i) => !i.awaitingApproval);
        if (!ready.length) out.push(t.todo0);
        else {
          out.push(fill(t.todo, { n: ready.length, first: ready[0].problem, date: day(ready[0].dueDate) }));
          if (!m) out.push(itemAnswer(ready[0], t, x));
        }
        if (todo.some((i) => i.awaitingApproval)) out.push(t.wait);
        break;
      }
      case "weather": if (ctx.weather) out.push(fill(t.weather, { rain: ctx.weather.rain_mm_48h, wind: Math.round(ctx.weather.wind_kmh), temp: Math.round(ctx.weather.temp_c) }) + (ctx.weather.rain_mm_48h >= 10 ? t.weatherBad : "")); break;
      case "harvest": out.push(ctx.harvest?.length ? fill(t.harvest, { state: ctx.harvest.map((h) => h.state.replace(/_/g, " ") + (h.windowStart ? ` (${day(h.windowStart)})` : "")).join(", ") }) : t.harvest0); break;
      case "quality": out.push(ctx.latest?.defect == null && ctx.latest?.doctorGrade ? `Grade: ${ctx.latest.doctorGrade}.` : ctx.latest ? fill(t.quality, { defect: ctx.latest.defect ?? "—", colour: ctx.latest.colour ?? "—" }) : t.quality0); break;
      case "help": out.push(t.help); break;
      case "price": out.push(x.price); break;
      case "cert": out.push(x.cert); break;
      case "stage": out.push(ctx.crops?.length ? fill(x.stage, { crops: ctx.crops.map((c) => `${c.variety || ""} ${c.plot || ""}${c.stage ? " – " + c.stage.name : ""}`.trim()).join("; ") }) : x.stage0); break;
      case "visit": out.push(ctx.visits?.length ? fill(x.visit, { date: day(ctx.visits[0].at) }) : x.visit0); break;
      case "gap": {
        const rows = (ctx.buyerStandard || []).flatMap((s) => (s.rows || []).map((r) => ({ ...r, grade: s.grade })));
        const bad = rows.filter((r) => r.ok === false);
        out.push(rows.length ? (bad.length ? fill(x.gap, { grade: bad[0].grade, n: bad.length }) : x.gap0) : t.quality0); break;
      }
      case "done": out.push(ctx.done?.length ? fill(x.doneN, { n: ctx.done.length }) : t.todo0); break;
      case "summary": out.push(`${x.summary} ${summary(ctx, t, x)}`); break;
    }
  }
  if (!out.length) out.push(fill(x.generic, { summary: summary(ctx, t, x) }), x.more);
  return [...new Set(out)].join("\n\n");
}

