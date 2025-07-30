import { inputToString } from "../src/helpers";

const text = `1 A
2 ABCD
3 你好
4 Lorem ipsum dolor sit amet
5 Hello こんにちは 안녕하세요 你好 😀😃😄😁😆
6 abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789
7 这是一段中文，用于测试宽度显示效果。
8 😀😃😄😁😆😅😂🤣😊😇🙂🙃😉😌😍🥰😘😗😙😚
9 Coding is fun! 编程很有趣！코딩은 재미있어요！👨‍💻👩‍💻
10 The quick brown fox jumps over the lazy dog. 快速的棕色狐狸跳过懒狗。
11 🌸🌼🌻🌺🌹🌷🌱🌲🌳🌴🌵🌾🌿🍀🍁🍂🍃
12 The rain in Spain stays mainly in the plain. 西班牙的雨主要下在平原上。
13 1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ🌈🔥💧❄️🍀🌸
14 这是一段非常非常长的中文文本，用于模拟宽度测试，看看换行逻辑是否正确处理这些复杂的字符。
15 🧠🫀🫁🦷🦴🦿🦾🧬🔬👀👅👄👃👂👣🧠🫀🫁🦷🦴🦿🦾🧬
16 Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore
17 Testing line 17 with a mix of characters: 汉字, Emoji 🎉🎊, and ASCII!
18 🌍🌎🌏🌐🌑🌒🌓🌔🌕🌖🌗🌘🌙🌚🌛🌜🌝
19 Mixed: Hello 世界 🌈🔥💧❄️🍀🌸🌼🌻🌺🌹🌷🌱🌲🌳
20 A line with CJK + emoji + ASCII to push the limits: 编程测试
21 Another long one: 🧵🧶🪡🪢🪣🪤🪥🪦🪧🪨🪩🪪🪫🪬🪭🪮🪯🪰🪱🪲🪳🪴🪵
22 Hello world! 👋 你好世界！こんにちは世界！안녕하세요 세상! 🌍🌎🌏
23 This is a relatively long ASCII line to balance things out, adding more letters and digits 1234567890.
24 🦕🦖🌪️🧊🔥❄️💧💦🌈⛅☁️🌤️🌞🌛🌜🌚🌝🌎🌍🌏🌐
25 Testing pure CJK: 测试一些不同的中文行来确认显示宽度和换行是否一致。
26 Lorem ipsum dolor sit amet, consectetur adipiscing elit. Curabitur vel hendrerit libero.
27 📚📖📝✏️🔍🧠💭🎓🏫📊📈🧬🔬⚗️🧪💡🧱🛠️⚙️🖥️💾📦
28 Just text 🧠🫀🫁🦷🦴🦿🦾🦻🧏‍♀️👀👁️👅👄👃👂, nothing special here.
29 混合行包括各种字符和符号，用于终端宽度测试。
30 The line number 30 is where we add a longer message to challenge rendering in edge cases 😺😸😹😻
31 🏞️🌄🌅🌆🌇🌉🌁🌃🌌🌠🌇🌆🏙️🌃🌌✨🌟💫
32 Super wide test line, padding it further and further until we exceed normal expectations... 👨‍👩‍👧‍👦👨‍👩‍👧‍👧👩‍👩‍👧‍👧
33 这是一段非常长的文字，为了确保终端在渲染时不会出错，我们加入足够的内容来测试分页功能是否正常
34 🚀🚀🚀 Testing long emoji-only line 🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀
35 Final big mix: ABC汉字🙂🙃😉😌😍🥰😘😗😙😚🤪🤨🧐🤓😎🥸🤩🥳🤗🤔
36 One more to end!!!
37 THE END 🚩🚩🚩🚩🚩🚩🚩🚩🚩🚩🚩🚩🚩🚩🚩🚩🚩🚩🚩🚩🚩🚩🚩🚩🚩`;

export const content = inputToString(text, false);