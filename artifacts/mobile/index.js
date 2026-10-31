// Register native call/background handlers before mounting the router. Do not
// put these in a React effect: a terminated app can be answered before it mounts.
require("./services/nativeCalls").initializeNativeCallHandlers();
require("expo-router/entry");
