//+------------------------------------------------------------------+
//|                                            NRXTRADER_SYNA.mq5    |
//|                                                                  |
//| Connects to NRXTRADER WebSocket server, receives signals,        |
//| executes trades on user's broker account.                        |
//+------------------------------------------------------------------+
#property copyright "NRXTRADER"
#property link      "https://nrxtrader.com"
#property version   "1.00"
#property strict

// --- Input parameters (set by user) ---
input string   API_KEY = "";           // API Key from NRXTRADER dashboard
input string   ACCOUNT_ID = "";        // Account ID from NRXTRADER dashboard
input string   WS_URL = "wss://nrxtrader-api.onrender.com"; // WebSocket server
input double   DEFAULT_LOT = 0.01;     // Default lot size (can be overridden by signal)
input int      MAX_POSITIONS = 5;      // Maximum open positions at once

// --- WebSocket connection handle ---
int      ws_socket = INVALID_HANDLE;
string   ws_url_full;
bool     connected = false;
bool     authenticated = false;
string   last_error = "";

// --- Heartbeat timer ---
datetime last_heartbeat = 0;
const int HEARTBEAT_INTERVAL = 30; // seconds

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   // Validate inputs
   if (StringLen(API_KEY) == 0 || StringLen(ACCOUNT_ID) == 0)
   {
      Print("ERROR: API_KEY and ACCOUNT_ID must be set in EA inputs.");
      return(INIT_FAILED);
   }
   
   // Construct WebSocket URL with query parameters for authentication
   ws_url_full = WS_URL + "?api_key=" + API_KEY + "&account_id=" + ACCOUNT_ID;
   
   // Connect to WebSocket
   ConnectWebSocket();
   
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   if (ws_socket != INVALID_HANDLE)
   {
      WebSocketClose(ws_socket, 1000, "Normal closure");
      ws_socket = INVALID_HANDLE;
   }
   Print("EA removed.");
}

//+------------------------------------------------------------------+
//| Expert tick function (called on every price tick)                |
//+------------------------------------------------------------------+
void OnTick()
{
   // Reconnect if disconnected
   if (!connected && ws_socket == INVALID_HANDLE)
      ConnectWebSocket();
   
   // Process incoming WebSocket messages
   if (connected)
      ProcessWebSocketMessages();
   
   // Send heartbeat every 30 seconds
   if (connected && (TimeCurrent() - last_heartbeat) >= HEARTBEAT_INTERVAL)
   {
      SendHeartbeat();
      last_heartbeat = TimeCurrent();
   }
}

//+------------------------------------------------------------------+
//| Connect to WebSocket server                                      |
//+------------------------------------------------------------------+
void ConnectWebSocket()
{
   Print("Connecting to WebSocket: ", ws_url_full);
   ws_socket = WebSocketConnect(ws_url_full, true);
   if (ws_socket == INVALID_HANDLE)
   {
      Print("WebSocket connection failed. Will retry...");
      connected = false;
      return;
   }
   connected = true;
   Print("WebSocket connected. Waiting for authentication...");
   
   // Send authentication message immediately
   SendAuthMessage();
}

//+------------------------------------------------------------------+
//| Send authentication message                                      |
//+------------------------------------------------------------------+
void SendAuthMessage()
{
   string auth_msg = "{"
                     "\"type\":\"auth\","
                     "\"account_id\":\"" + ACCOUNT_ID + "\","
                     "\"api_key\":\"" + API_KEY + "\""
                     "}";
   WebSocketSend(ws_socket, auth_msg);
   Print("Auth message sent.");
}

//+------------------------------------------------------------------+
//| Send heartbeat message                                           |
//+------------------------------------------------------------------+
void SendHeartbeat()
{
   string ping_msg = "{\"type\":\"ping\"}";
   WebSocketSend(ws_socket, ping_msg);
}

//+------------------------------------------------------------------+
//| Process incoming WebSocket messages                              |
//+------------------------------------------------------------------+
void ProcessWebSocketMessages()
{
   string message;
   while (WebSocketReceive(ws_socket, message, 10))  // non-blocking
   {
      if (StringLen(message) == 0) continue;
      Print("Received: ", message);
      
      // Parse JSON (simplified – in production use a JSON library)
      if (StringFind(message, "\"type\":\"auth_response\"") >= 0)
      {
         if (StringFind(message, "\"success\":true") >= 0)
         {
            authenticated = true;
            Print("Authenticated successfully.");
            // Check if subscription/trial is active
            if (StringFind(message, "\"can_trade\":false") >= 0)
            {
               Alert("NRXTRADER: Your trial has ended or subscription expired. Please subscribe.");
               Print("Trial expired / no subscription.");
            }
         }
         else
         {
            Print("Authentication failed.");
            connected = false;
            WebSocketClose(ws_socket, 1000, "Auth failed");
            ws_socket = INVALID_HANDLE;
            return;
         }
      }
      else if (StringFind(message, "\"type\":\"signal\"") >= 0)
      {
         if (!authenticated)
         {
            Print("Not authenticated, ignoring signal.");
            continue;
         }
         // Execute trade signal
         ExecuteTrade(message);
      }
      else if (StringFind(message, "\"type\":\"pong\"") >= 0)
      {
         // heartbeat response, ignore
      }
      else if (StringFind(message, "\"type\":\"error\"") >= 0)
      {
         Print("Server error: ", message);
      }
   }
}

//+------------------------------------------------------------------+
//| Execute trade based on signal JSON                               |
//+------------------------------------------------------------------+
void ExecuteTrade(string json)
{
   // Extract fields (simple string search – for production, use a JSON parser)
   string symbol = ExtractJsonString(json, "symbol");
   string action = ExtractJsonString(json, "action");
   double lot = ExtractJsonDouble(json, "lot_size");
   double sl = ExtractJsonDouble(json, "stop_loss");
   double tp = ExtractJsonDouble(json, "take_profit");
   
   if (lot <= 0) lot = DEFAULT_LOT;
   
   // Check maximum positions
   int positions = CountOpenPositions(symbol);
   if (positions >= MAX_POSITIONS)
   {
      Print("Max positions reached (", MAX_POSITIONS, "). Not trading.");
      return;
   }
   
   // Normalize symbol (MT5 uses suffixes like .m, .b, etc. - adjust as needed)
   string mt5_symbol = symbol;
   // If symbol is "EURUSD" but broker uses "EURUSDm", you might need mapping.
   // For now, use as is.
   
   // Prepare request
   MqlTradeRequest request = {};
   MqlTradeResult result = {};
   request.symbol = mt5_symbol;
   request.volume = lot;
   request.deviation = 10;
   request.type_filling = ORDER_FILLING_FOK;
   
   if (action == "BUY")
   {
      request.action = TRADE_ACTION_DEAL;
      request.type = ORDER_TYPE_BUY;
      request.price = SymbolInfoDouble(mt5_symbol, SYMBOL_ASK);
   }
   else if (action == "SELL")
   {
      request.action = TRADE_ACTION_DEAL;
      request.type = ORDER_TYPE_SELL;
      request.price = SymbolInfoDouble(mt5_symbol, SYMBOL_BID);
   }
   else
   {
      Print("Unknown action: ", action);
      return;
   }
   
   // Set stop loss and take profit if provided
   if (sl > 0) request.sl = sl;
   if (tp > 0) request.tp = tp;
   
   // Send order
   if (OrderSend(request, result))
   {
      Print("Order sent: ", result.order, " | ", result.comment);
      // Report back to server (optional)
      ReportTradeResult(result.order, symbol, action, lot, true, "");
   }
   else
   {
      string err_msg = "Order failed: " + IntegerToString(GetLastError());
      Print(err_msg);
      ReportTradeResult(0, symbol, action, lot, false, err_msg);
   }
}

//+------------------------------------------------------------------+
//| Helper: extract string from JSON                                 |
//+------------------------------------------------------------------+
string ExtractJsonString(string json, string key)
{
   string search = "\"" + key + "\":\"";
   int pos = StringFind(json, search);
   if (pos == -1) return "";
   pos += StringLen(search);
   int end = StringFind(json, "\"", pos);
   if (end == -1) return "";
   return StringSubstr(json, pos, end - pos);
}

//+------------------------------------------------------------------+
//| Helper: extract double from JSON                                 |
//+------------------------------------------------------------------+
double ExtractJsonDouble(string json, string key)
{
   string search = "\"" + key + "\":";
   int pos = StringFind(json, search);
   if (pos == -1) return 0;
   pos += StringLen(search);
   int end = pos;
   while (end < StringLen(json) && (StringGetChar(json, end) >= '0' && StringGetChar(json, end) <= '9' || StringGetChar(json, end) == '.' || StringGetChar(json, end) == '-'))
      end++;
   string num = StringSubstr(json, pos, end - pos);
   return StringToDouble(num);
}

//+------------------------------------------------------------------+
//| Count open positions for a symbol                                |
//+------------------------------------------------------------------+
int CountOpenPositions(string symbol)
{
   int count = 0;
   for (int i = 0; i < PositionsTotal(); i++)
   {
      ulong ticket = PositionGetTicket(i);
      if (PositionSelectByTicket(ticket))
      {
         if (PositionGetString(POSITION_SYMBOL) == symbol)
            count++;
      }
   }
   return count;
}

//+------------------------------------------------------------------+
//| Report trade result back to server (optional)                    |
//+------------------------------------------------------------------+
void ReportTradeResult(long order_id, string symbol, string action, double lot, bool success, string error)
{
   string msg = "{"
                "\"type\":\"trade_result\","
                "\"request_id\":\"\"," // optionally track request ID
                "\"status\":\"" + (success ? "executed" : "failed") + "\","
                "\"order_id\":" + IntegerToString(order_id) + ","
                "\"symbol\":\"" + symbol + "\","
                "\"action\":\"" + action + "\","
                "\"lot_size\":" + DoubleToString(lot, 2) + ","
                "\"error\":\"" + error + "\""
                "}";
   WebSocketSend(ws_socket, msg);
   Print("Report sent: ", msg);
}
