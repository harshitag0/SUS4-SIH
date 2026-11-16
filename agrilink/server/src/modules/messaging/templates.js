/**
 * Farmer message templates in 7 languages. The same wording must be registered as
 *   - WhatsApp Business message templates named `agrilink_<key>` (one per language, body variables {{1}}, {{2}} … in `params` order)
 *   - DLT SMS templates (India) with {#var#} in the same places; their DLT template ids go in SMS_DLT_TEMPLATE_IDS.
 * Keep texts short (SMS) and plain. Native-speaker review is required before production registration.
 * `sms: true` marks the alerts that are also sent by SMS (important / critical only).
 */
export const LANG_CODES = { en: "en", hi: "hi", mr: "mr", gu: "gu", ta: "ta", te: "te", kn: "kn" };
export const SPEECH_CODES = { en: "en-IN", hi: "hi-IN", mr: "mr-IN", gu: "gu-IN", ta: "ta-IN", te: "te-IN", kn: "kn-IN" };

export const TEMPLATES = {
  inspection_result: { sms: false, params: ["result"], text: {
    en: "AgriLink: New quality result for your mangoes: {result}. See details in the app.",
    hi: "AgriLink: आपके आमों का नया गुणवत्ता परिणाम: {result}। विवरण ऐप में देखें।",
    mr: "AgriLink: तुमच्या आंब्यांचा नवा गुणवत्ता निकाल: {result}. तपशील ॲपमध्ये पाहा.",
    gu: "AgriLink: તમારી કેરીનું નવું ગુણવત્તા પરિણામ: {result}. વિગતો એપમાં જુઓ.",
    ta: "AgriLink: உங்கள் மாம்பழங்களின் புதிய தர முடிவு: {result}. விவரங்களை செயலியில் பாருங்கள்.",
    te: "AgriLink: మీ మామిడి పండ్ల కొత్త నాణ్యత ఫలితం: {result}. వివరాలు యాప్‌లో చూడండి.",
    kn: "AgriLink: ನಿಮ್ಮ ಮಾವಿನ ಹಣ್ಣಿನ ಹೊಸ ಗುಣಮಟ್ಟ ಫಲಿತಾಂಶ: {result}. ವಿವರಗಳನ್ನು ಆ್ಯಪ್‌ನಲ್ಲಿ ನೋಡಿ." } },
  quality_gap: { sms: true, params: ["count", "problem"], text: {
    en: "AgriLink: {count} quality gap(s) found in your fruit. Most important: {problem}. Open My advice.",
    hi: "AgriLink: आपके फलों में {count} गुणवत्ता कमी मिली। सबसे ज़रूरी: {problem}। 'मेरी सलाह' खोलें।",
    mr: "AgriLink: तुमच्या फळांत {count} गुणवत्ता तफावत आढळली. सर्वात महत्त्वाची: {problem}. 'माझा सल्ला' उघडा.",
    gu: "AgriLink: તમારા ફળમાં {count} ગુણવત્તા ખામી મળી. સૌથી અગત્યની: {problem}. 'મારી સલાહ' ખોલો.",
    ta: "AgriLink: உங்கள் பழங்களில் {count} தரக் குறைபாடு கண்டறியப்பட்டது. முக்கியமானது: {problem}. 'என் ஆலோசனை' திறக்கவும்.",
    te: "AgriLink: మీ పండ్లలో {count} నాణ్యత లోపం కనిపించింది. ముఖ్యమైనది: {problem}. 'నా సలహా' తెరవండి.",
    kn: "AgriLink: ನಿಮ್ಮ ಹಣ್ಣಿನಲ್ಲಿ {count} ಗುಣಮಟ್ಟದ ಕೊರತೆ ಕಂಡುಬಂದಿದೆ. ಮುಖ್ಯವಾದುದು: {problem}. 'ನನ್ನ ಸಲಹೆ' ತೆರೆಯಿರಿ." } },
  new_recommendation: { sms: false, params: ["problem", "action", "due"], text: {
    en: "AgriLink advice: {problem}. What to do: {action}. Complete by {due}.",
    hi: "AgriLink सलाह: {problem}। क्या करें: {action}। {due} तक पूरा करें।",
    mr: "AgriLink सल्ला: {problem}. काय करावे: {action}. {due} पर्यंत पूर्ण करा.",
    gu: "AgriLink સલાહ: {problem}. શું કરવું: {action}. {due} સુધીમાં પૂરું કરો.",
    ta: "AgriLink ஆலோசனை: {problem}. செய்ய வேண்டியது: {action}. {due}க்குள் முடிக்கவும்.",
    te: "AgriLink సలహా: {problem}. ఏమి చేయాలి: {action}. {due} లోపు పూర్తి చేయండి.",
    kn: "AgriLink ಸಲಹೆ: {problem}. ಏನು ಮಾಡಬೇಕು: {action}. {due} ರೊಳಗೆ ಮುಗಿಸಿ." } },
  crop_care_reminder: { sms: true, params: ["action", "due"], text: {
    en: "AgriLink reminder: {action}. Due {due}.",
    hi: "AgriLink याद दिलाना: {action}। अंतिम तारीख़ {due}।",
    mr: "AgriLink आठवण: {action}. अंतिम तारीख {due}.",
    gu: "AgriLink યાદ અપાવવું: {action}. છેલ્લી તારીખ {due}.",
    ta: "AgriLink நினைவூட்டல்: {action}. கடைசி நாள் {due}.",
    te: "AgriLink గుర్తు: {action}. గడువు {due}.",
    kn: "AgriLink ನೆನಪು: {action}. ಕೊನೆಯ ದಿನ {due}." } },
  quality_warning: { sms: true, params: ["problem"], text: {
    en: "AgriLink WARNING: {problem}. Act today - see My advice or call your FPO.",
    hi: "AgriLink चेतावनी: {problem}। आज ही कदम उठाएँ - 'मेरी सलाह' देखें या FPO को फ़ोन करें।",
    mr: "AgriLink इशारा: {problem}. आजच कृती करा - 'माझा सल्ला' पाहा किंवा FPO ला फोन करा.",
    gu: "AgriLink ચેતવણી: {problem}. આજે જ પગલાં લો - 'મારી સલાહ' જુઓ અથવા FPO ને ફોન કરો.",
    ta: "AgriLink எச்சரிக்கை: {problem}. இன்றே செயல்படுங்கள் - 'என் ஆலோசனை' பாருங்கள் அல்லது FPO-வை அழையுங்கள்.",
    te: "AgriLink హెచ్చరిక: {problem}. ఈరోజే చర్య తీసుకోండి - 'నా సలహా' చూడండి లేదా FPOకి ఫోన్ చేయండి.",
    kn: "AgriLink ಎಚ್ಚರಿಕೆ: {problem}. ಇಂದೇ ಕ್ರಮ ಕೈಗೊಳ್ಳಿ - 'ನನ್ನ ಸಲಹೆ' ನೋಡಿ ಅಥವಾ FPO ಗೆ ಕರೆ ಮಾಡಿ." } },
  visit_upcoming: { sms: true, params: ["date"], text: {
    en: "AgriLink: Your farmer doctor will visit your orchard on {date}. Keep your spray and harvest records ready.",
    hi: "AgriLink: फ़ार्मर डॉक्टर {date} को आपके बाग़ में आएँगे। छिड़काव और तुड़ाई रिकॉर्ड तैयार रखें।",
    mr: "AgriLink: फार्मर डॉक्टर {date} रोजी तुमच्या बागेत येतील. फवारणी आणि तोडणी नोंदी तयार ठेवा.",
    gu: "AgriLink: ફાર્મર ડૉક્ટર {date} ના રોજ તમારા બગીચે આવશે. છંટકાવ અને લણણીના રેકોર્ડ તૈયાર રાખો.",
    ta: "AgriLink: உங்கள் விவசாய மருத்துவர் {date} அன்று தோட்டத்திற்கு வருவார். தெளிப்பு, அறுவடை பதிவுகளை தயாராக வைத்திருங்கள்.",
    te: "AgriLink: మీ రైతు డాక్టర్ {date}న మీ తోటకు వస్తారు. పిచికారీ, కోత రికార్డులు సిద్ధంగా ఉంచండి.",
    kn: "AgriLink: ನಿಮ್ಮ ರೈತ ವೈದ್ಯರು {date} ರಂದು ನಿಮ್ಮ ತೋಟಕ್ಕೆ ಬರುತ್ತಾರೆ. ಸಿಂಪಡಣೆ ಮತ್ತು ಕೊಯ್ಲು ದಾಖಲೆಗಳನ್ನು ಸಿದ್ಧವಾಗಿಡಿ." } },
  harvest_readiness: { sms: true, params: ["days", "status"], text: {
    en: "AgriLink: Harvest window opens in {days} day(s). Quality status: {status}. Clear quality before harvest.",
    hi: "AgriLink: तुड़ाई {days} दिन में शुरू। गुणवत्ता स्थिति: {status}। तुड़ाई से पहले गुणवत्ता मंज़ूर कराएँ।",
    mr: "AgriLink: तोडणी {days} दिवसांत सुरू. गुणवत्ता स्थिती: {status}. तोडणीपूर्वी गुणवत्ता मंजूर करून घ्या.",
    gu: "AgriLink: લણણી {days} દિવસમાં શરૂ. ગુણવત્તા સ્થિતિ: {status}. લણણી પહેલાં ગુણવત્તા મંજૂર કરાવો.",
    ta: "AgriLink: அறுவடை {days} நாளில் தொடங்கும். தர நிலை: {status}. அறுவடைக்கு முன் தரத்தை உறுதி செய்யுங்கள்.",
    te: "AgriLink: కోత {days} రోజుల్లో మొదలవుతుంది. నాణ్యత స్థితి: {status}. కోతకు ముందే నాణ్యత ఆమోదం పొందండి.",
    kn: "AgriLink: ಕೊಯ್ಲು {days} ದಿನಗಳಲ್ಲಿ ಆರಂಭ. ಗುಣಮಟ್ಟ ಸ್ಥಿತಿ: {status}. ಕೊಯ್ಲಿಗೆ ಮೊದಲು ಗುಣಮಟ್ಟ ಅನುಮೋದನೆ ಪಡೆಯಿರಿ." } },
  reinspection_reminder: { sms: true, params: ["date"], text: {
    en: "AgriLink: Quality re-check due on {date}. Upload 3 clear daylight photos of your fruit.",
    hi: "AgriLink: {date} को गुणवत्ता की दोबारा जाँच। फल की 3 साफ़ दिन की रोशनी वाली फ़ोटो अपलोड करें।",
    mr: "AgriLink: {date} रोजी गुणवत्तेची पुन्हा तपासणी. फळाचे 3 स्पष्ट दिवसाच्या उजेडातील फोटो अपलोड करा.",
    gu: "AgriLink: {date} ના રોજ ગુણવત્તાની ફરી તપાસ. ફળના 3 સ્પષ્ટ દિવસના પ્રકાશમાં ફોટો અપલોડ કરો.",
    ta: "AgriLink: {date} அன்று தர மறுபரிசோதனை. பழத்தின் 3 தெளிவான பகல் வெளிச்ச புகைப்படங்களை பதிவேற்றுங்கள்.",
    te: "AgriLink: {date}న నాణ్యత మళ్లీ తనిఖీ. పండ్ల 3 స్పష్టమైన పగటి వెలుతురు ఫోటోలు అప్‌లోడ్ చేయండి.",
    kn: "AgriLink: {date} ರಂದು ಗುಣಮಟ್ಟ ಮರುಪರಿಶೀಲನೆ. ಹಣ್ಣಿನ 3 ಸ್ಪಷ್ಟ ಹಗಲು ಬೆಳಕಿನ ಫೋಟೋಗಳನ್ನು ಅಪ್‌ಲೋಡ್ ಮಾಡಿ." } },
  photo_check_due: { sms: true, params: ["deadline"], text: {
    en: "AgriLink: Photo check due. Upload 3 photos of your fruit by {deadline}.",
    hi: "AgriLink: फ़ोटो जाँच बाकी। {deadline} तक फल की 3 फ़ोटो अपलोड करें।",
    mr: "AgriLink: फोटो तपासणी बाकी. {deadline} पर्यंत फळाचे 3 फोटो अपलोड करा.",
    gu: "AgriLink: ફોટો તપાસ બાકી. {deadline} સુધીમાં ફળના 3 ફોટો અપલોડ કરો.",
    ta: "AgriLink: புகைப்பட சோதனை நிலுவையில். {deadline}க்குள் பழத்தின் 3 புகைப்படங்களை பதிவேற்றுங்கள்.",
    te: "AgriLink: ఫోటో తనిఖీ పెండింగ్. {deadline} లోపు పండ్ల 3 ఫోటోలు అప్‌లోడ్ చేయండి.",
    kn: "AgriLink: ಫೋಟೋ ಪರಿಶೀಲನೆ ಬಾಕಿ. {deadline} ರೊಳಗೆ ಹಣ್ಣಿನ 3 ಫೋಟೋಗಳನ್ನು ಅಪ್‌ಲೋಡ್ ಮಾಡಿ." } },
  harvest_schedule: { sms: true, params: ["kg", "date"], text: {
    en: "AgriLink: Harvest notice - pick {kg} kg around {date} (early morning) and bring it to your FPO collection point.",
    hi: "AgriLink: तुड़ाई सूचना - {date} के आसपास (सुबह जल्दी) {kg} किलो तोड़ें और FPO इकट्ठा केंद्र पर लाएँ।",
    mr: "AgriLink: तोडणी सूचना - {date} च्या आसपास (पहाटे) {kg} किलो तोडा आणि FPO संकलन केंद्रावर आणा.",
    gu: "AgriLink: લણણી સૂચના - {date} આસપાસ (વહેલી સવારે) {kg} કિલો તોડો અને FPO સંગ્રહ કેન્દ્ર પર લાવો.",
    ta: "AgriLink: அறுவடை அறிவிப்பு - {date} அளவில் (அதிகாலை) {kg} கிலோ பறித்து FPO சேகரிப்பு மையத்திற்கு கொண்டு வாருங்கள்.",
    te: "AgriLink: కోత సూచన - {date} సమయంలో (తెల్లవారుజామున) {kg} కిలోలు కోసి FPO సేకరణ కేంద్రానికి తీసుకురండి.",
    kn: "AgriLink: ಕೊಯ್ಲು ಸೂಚನೆ - {date} ಸುಮಾರಿಗೆ (ಬೆಳಿಗ್ಗೆ ಬೇಗ) {kg} ಕೆಜಿ ಕೊಯ್ದು FPO ಸಂಗ್ರಹ ಕೇಂದ್ರಕ್ಕೆ ತನ್ನಿ." } },
  agreement_update: { sms: true, params: ["id", "event"], text: {
    en: "AgriLink: Agreement {id} - {event}. See Agreements in the app.",
    hi: "AgriLink: अनुबंध {id} - {event}। ऐप में अनुबंध देखें।",
    mr: "AgriLink: करार {id} - {event}. ॲपमध्ये करार पाहा.",
    gu: "AgriLink: કરાર {id} - {event}. એપમાં કરાર જુઓ.",
    ta: "AgriLink: ஒப்பந்தம் {id} - {event}. செயலியில் ஒப்பந்தங்களைப் பாருங்கள்.",
    te: "AgriLink: ఒప్పందం {id} - {event}. యాప్‌లో ఒప్పందాలు చూడండి.",
    kn: "AgriLink: ಒಪ್ಪಂದ {id} - {event}. ಆ್ಯಪ್‌ನಲ್ಲಿ ಒಪ್ಪಂದಗಳನ್ನು ನೋಡಿ." } },
  action_verified: { sms: false, params: ["problem", "result"], text: {
    en: "AgriLink: Your farmer doctor checked your work on \"{problem}\": {result}.",
    hi: "AgriLink: फ़ार्मर डॉक्टर ने \"{problem}\" पर आपका काम जाँचा: {result}।",
    mr: "AgriLink: फार्मर डॉक्टरने \"{problem}\" वरील तुमचे काम तपासले: {result}.",
    gu: "AgriLink: ફાર્મર ડૉક્ટરે \"{problem}\" પરનું તમારું કામ તપાસ્યું: {result}.",
    ta: "AgriLink: \"{problem}\" குறித்த உங்கள் வேலையை விவசாய மருத்துவர் சரிபார்த்தார்: {result}.",
    te: "AgriLink: \"{problem}\"పై మీ పనిని రైతు డాక్టర్ తనిఖీ చేశారు: {result}.",
    kn: "AgriLink: \"{problem}\" ಕುರಿತ ನಿಮ್ಮ ಕೆಲಸವನ್ನು ರೈತ ವೈದ್ಯರು ಪರಿಶೀಲಿಸಿದರು: {result}." } },
};

/** Small words used inside messages ({result}, {event}, {status}). */
export const WORDS = {
  improved: { en: "improved", hi: "सुधार हुआ", mr: "सुधारणा झाली", gu: "સુધારો થયો", ta: "மேம்பட்டது", te: "మెరుగుపడింది", kn: "ಸುಧಾರಿಸಿದೆ" },
  worse: { en: "got worse", hi: "बिगड़ा", mr: "बिघडले", gu: "બગડ્યું", ta: "மோசமானது", te: "క్షీణించింది", kn: "ಹದಗೆಟ್ಟಿದೆ" },
  unchanged: { en: "no clear change", hi: "कोई स्पष्ट बदलाव नहीं", mr: "स्पष्ट बदल नाही", gu: "સ્પષ્ટ ફેરફાર નથી", ta: "தெளிவான மாற்றம் இல்லை", te: "స్పష్టమైన మార్పు లేదు", kn: "ಸ್ಪಷ್ಟ ಬದಲಾವಣೆ ಇಲ್ಲ" },
  meets: { en: "meets the buyer's grade", hi: "खरीदार के ग्रेड के अनुसार", mr: "खरेदीदाराच्या ग्रेडनुसार", gu: "ખરીદારના ગ્રેડ મુજબ", ta: "வாங்குபவரின் தரத்திற்கு ஏற்றது", te: "కొనుగోలుదారు గ్రేడ్‌కు సరిపోతుంది", kn: "ಖರೀದಿದಾರರ ಗ್ರೇಡ್‌ಗೆ ಸರಿಹೊಂದುತ್ತದೆ" },
  gaps: { en: "gaps found", hi: "कमियाँ मिलीं", mr: "तफावत आढळली", gu: "ખામીઓ મળી", ta: "குறைபாடுகள் கண்டறியப்பட்டன", te: "లోపాలు కనిపించాయి", kn: "ಕೊರತೆಗಳು ಕಂಡುಬಂದಿವೆ" },
  verified: { en: "done correctly", hi: "सही किया गया", mr: "योग्य केले", gu: "યોગ્ય રીતે કર્યું", ta: "சரியாக செய்யப்பட்டது", te: "సరిగ్గా చేశారు", kn: "ಸರಿಯಾಗಿ ಮಾಡಲಾಗಿದೆ" },
  not_effective: { en: "more work needed", hi: "और काम ज़रूरी", mr: "आणखी काम आवश्यक", gu: "વધુ કામ જરૂરી", ta: "மேலும் வேலை தேவை", te: "ఇంకా పని అవసరం", kn: "ಇನ್ನಷ್ಟು ಕೆಲಸ ಅಗತ್ಯ" },
  ev_sign_request: { en: "please review and sign", hi: "कृपया देखें और साइन करें", mr: "कृपया पाहा आणि सही करा", gu: "કૃપા કરીને જુઓ અને સહી કરો", ta: "பார்த்து கையொப்பமிடவும்", te: "దయచేసి చూసి సంతకం చేయండి", kn: "ದಯವಿಟ್ಟು ನೋಡಿ ಸಹಿ ಮಾಡಿ" },
  ev_signed: { en: "the other party signed", hi: "दूसरे पक्ष ने साइन किया", mr: "दुसऱ्या पक्षाने सही केली", gu: "બીજા પક્ષે સહી કરી", ta: "மற்ற தரப்பு கையொப்பமிட்டது", te: "మరొక పక్షం సంతకం చేసింది", kn: "ಇನ್ನೊಂದು ಪಕ್ಷ ಸಹಿ ಮಾಡಿದೆ" },
  ev_registered: { en: "active and recorded on blockchain", hi: "सक्रिय और ब्लॉकचेन पर दर्ज", mr: "सक्रिय आणि ब्लॉकचेनवर नोंद", gu: "સક્રિય અને બ્લોકચેન પર નોંધાયેલ", ta: "செயலில், பிளாக்செயினில் பதிவு", te: "సక్రియం, బ్లాక్‌చెయిన్‌లో నమోదు", kn: "ಸಕ್ರಿಯ, ಬ್ಲಾಕ್‌ಚೈನ್‌ನಲ್ಲಿ ದಾಖಲು" },
  ev_certificate: { en: "quality certificate issued", hi: "गुणवत्ता प्रमाणपत्र जारी", mr: "गुणवत्ता प्रमाणपत्र दिले", gu: "ગુણવત્તા પ્રમાણપત્ર જારી", ta: "தரச் சான்றிதழ் வழங்கப்பட்டது", te: "నాణ్యత ధృవపత్రం జారీ", kn: "ಗುಣಮಟ್ಟ ಪ್ರಮಾಣಪತ್ರ ನೀಡಲಾಗಿದೆ" },
  ev_stage: { en: "crop stage approved", hi: "फ़सल चरण मंज़ूर", mr: "पीक टप्पा मान्य", gu: "પાક તબક્કો મંજૂર", ta: "பயிர் நிலை ஒப்புதல்", te: "పంట దశ ఆమోదం", kn: "ಬೆಳೆ ಹಂತ ಅನುಮೋದನೆ" },
};

Object.assign(WORDS, {
  dec_approved: { en: "approved", hi: "मंज़ूर", mr: "मान्य", gu: "મંજૂર", ta: "ஒப்புதல்", te: "ఆమోదం", kn: "ಅನುಮೋದನೆ" },
  dec_rejected: { en: "rejected", hi: "अस्वीकार", mr: "नाकारले", gu: "નામંજૂર", ta: "நிராகரிப்பு", te: "తిరస్కరణ", kn: "ತಿರಸ್ಕೃತ" },
  dec_requires_correction: { en: "correction needed", hi: "सुधार चाहिए", mr: "दुरुस्ती हवी", gu: "સુધારો જરૂરી", ta: "திருத்தம் தேவை", te: "దిద్దుబాటు అవసరం", kn: "ತಿದ್ದುಪಡಿ ಬೇಕು" },
});

export const word = (k, lang) => WORDS[k]?.[lang] || WORDS[k]?.en || k;

export function render(key, lang, params = {}) {
  const t = TEMPLATES[key];
  if (!t) throw new Error(`unknown template ${key}`);
  const L = t.text[lang] ? lang : "en";
  const body = t.text[L].replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? "—"));
  return { body, lang: L, ordered: t.params.map((k) => String(params[k] ?? "—")), sms: t.sms };
}
