/*
    Original Author: neo3587
    Source: https://github.com/neo3587/discord_cryptobot
    Modified By: Cryptominer#8245
    Modified Source: https://github.com/CryptominerPaul/ 
    TODO:
        - check if bulkdelete fails cause 2 weeks old messages => delete all them 1 by 1
*/

const Discord = require("discord.js");
const XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const config_json_file = path.dirname(process.argv[1]) + "/config.json"; 
const users_addr_folder = path.dirname(process.argv[1]) + "/.db_users_addr";
const users_mn_folder = path.dirname(process.argv[1]) + "/.db_users_mn";


/** @typedef {Object} Configuration
  * @property {string[]} special_ticker -
  * @property {Array<string|string[]>} ticker -
  * @property {number[]} color -
  * @property {string[]} devs -
  * @property {{block: number, coll?: number, mn?: number, pos?: number, pow?: number}[]} stages -
  * @property {{blockcount: string, mncount: string, supply: string, balance: string, blockindex: string, blockhash: string, mnstat: string}} requests -
  * @property {string[]} startorder -
  * @property {{enabled: true, channel: string, interval: 60}} monitor -
  * @property {boolean} hidenotsupported -
  * @property {boolean} useraddrs -
  * @property {boolean} usermns -
  * @property {string[]} channel -
  * @property {string} prefix -
  * @property {string} coin -
  * @property {number} blocktime -
  * @property {string} token -
*/
/** @type {Configuration} */
const conf = require(config_json_file);
const client = new Discord.Client();


class ExchangeData {
    constructor(name) {
        this.name = name;
        this.link = "";
        this.price = "Error";
        this.volume = "Error";
        this.buy = "Error";
        this.sell = "Error";
        this.change = "Error";
        // this.high ?
        // this.low ?
    }
    fillj(json, price, volume, buy, sell, change) {
        this.fill(json[price], json[volume], json[buy], json[sell], json[change]);
    }
    fill(price, volume, buy, sell, change) {
        if (price === undefined && volume === undefined && buy === undefined && sell === undefined && change === undefined)
            return;
        this.price  = isNaN(price)  ? undefined : parseFloat(price).toFixed(8);
        this.volume = isNaN(volume) ? undefined : parseFloat(volume).toFixed(4);
        this.buy    = isNaN(buy)    ? undefined : parseFloat(buy).toFixed(8);
        this.sell   = isNaN(sell)   ? undefined : parseFloat(sell).toFixed(8);
        this.change = isNaN(change) ? undefined : (change >= 0.0 ? "+" : "") + parseFloat(change).toFixed(2) + "%";
    }
}

function start_monitor() {
    if (conf.monitor !== undefined && conf.monitor.enabled === true) {

        const channel = client.channels.get(conf.monitor.channel);
        let embeds = [];
        let cmd = new BotCommand(undefined, txt => embeds.push(txt));
        
        const refresh_monitor = async () => {
            embeds = [];
            await cmd.price();
            await cmd.stats1();
            await cmd.stats2();
            await cmd.stats3();  
            await cmd.earnings(1 , 1 , 1);
            channel.bulkDelete(50).then(async () => {
                for (let emb of embeds)
                    await channel.send(emb);
            });
        };

        refresh_monitor();
        channel.client.setInterval(() => refresh_monitor(), conf.monitor.interval * 1000);
    }
}

function configure_systemd(name) {
    if (process.platform === "linux") {
        let service = "[Unit]\n" +
            "Description=" + name + " service\n" +
            "After=network.target\n" +
            "\n" +
            "[Service]\n" +
            "User=root\n" +
            "Group=root\n" +
            "ExecStart=" + process.argv[0] + " " + process.argv[1] + "\n" +
            "Restart=always\n" +
            "\n" +
            "[Install]\n" +
            "WantedBy=multi-user.target";

        fs.writeFileSync("/etc/systemd/system/" + name + ".service", service);
        bash_cmd("chmod +x /etc/systemd/system/" + name + ".service");
        bash_cmd("systemctl daemon-reload");
        bash_cmd("systemctl start " + name + ".service");
        bash_cmd("systemctl enable " + name + ".service");

        console.log("Start:              \x1b[1;32msystemctl start   " + name + ".service\x1b[0m");
        console.log("Stop:               \x1b[1;32msystemctl stop    " + name + ".service\x1b[0m");
        console.log("Start on reboot:    \x1b[1;32msystemctl enable  " + name + ".service\x1b[0m");
        console.log("No start on reboot: \x1b[1;32msystemctl disable " + name + ".service\x1b[0m");
        console.log("Status:             \x1b[1;32msystemctl status  " + name + ".service\x1b[0m");

        console.log("Current status: Running and Start on reboot");
    }
    else {
        console.log("Can't run on background in non-linux systems");
    }
    process.exit();
}

function get_ticker(ticker) {
    return new Promise((resolve, reject) => {

        const js_request = (url, fn) => {
            async_request(url).then(x => {
                try {
                    fn(JSON.parse(x));
                }
                catch (e) { /**/ }
                resolve(exdata);
            }).catch(() => resolve(exdata));
        };
        const ternary_try = (fn_try, res_catch) => {
            try {
                return fn_try();
            }
            catch (e) {
                return res_catch;
            }
        };

        let exdata, tmp, coin_up, coin_lw, exchange;

        if (Array.isArray(ticker)) {
            coin_up = [ticker[1].toUpperCase(), ticker[2].toUpperCase()];
            coin_lw = [ticker[1].toLowerCase(), ticker[2].toLowerCase()];
            exchange = ticker[0];
            exdata = new ExchangeData(`${exchange} (${coin_up[0] !== conf.coin.toUpperCase() ? coin_up[0] + "-" : ""}${coin_up[1]})`);
        }
        else {
            coin_up = [conf.coin.toUpperCase(), "BTC"];
            coin_lw = [conf.coin.toLowerCase(), "btc"];
            exchange = ticker;
            exdata = new ExchangeData(exchange);
        }

        switch (exchange.toLowerCase()) {
           case "crex24": {
                exdata.link = `https://crex24.com/exchange/${coin_up[0]}-${coin_up[1]}`;
                js_request(`https://api.crex24.com/v2/public/tickers?instrument=${coin_up[0]}-${coin_up[1]}`, res => exdata.fillj(res[0], "last", "baseVolume", "ask", "bid", "percentChange"));
                break;
            }
            case "graviex": {
                 exdata.link = `https://graviex.net/markets/${coin_lw[0]}${coin_lw[1]}`;
                 js_request(`https://graviex.net:443/api/v2/tickers/${coin_lw[0]}${coin_lw[1]}.json`, res => {
                         res = res.ticker;
                         exdata.fill(res.last, res.vol, res.sell, res.buy, res.change * 100);
                 });
                 break;
            }
            case "stex": {
                 exdata.link = `https://app.stex.com/en/trade/pair/${coin_up[1]}/${coin_up[0]}`;
                 js_request(`https://api3.stex.com/public/ticker/`, res => {
                         tmp = res["data"].find(x => x.symbol === `${coin_up[0]}_${coin_up[1]}`);
                         exdata.fill(tmp["last"], tmp["volumeQuote"], tmp["ask"], tmp["bid"], '');
                  });
                  break;
            }
            case "cratex": {
                exdata.link = `https://cratex.io/index.php?pair=${coin_up[0]}/${coin_up[1]}`;
                js_request(`https://cratex.io/api/v1/get_markets_json.php?market=${coin_up[0]}/${coin_up[1]}`, res => exdata.fillj(res, "latest_price" ,"volume24h", "buy_price" , "sell_price" , "" ));
                break;
            }
            case "zeonexchange": {
                exdata.link = `https://exchange.zeonhexalgo.fun/market/53`;
                js_request(`https://exchange.zeonhexalgo.fun/page/api?method=singlemarket&marketid=53`, res => exdata.fillj(res["return"][0], "lasttradeprice", "volume24h", "sell", "buy", "0"));
                break;
            }
            case "tradebtc": {
                exdata.link = `https://tradebtc.zeonhexalgo.fun/market/BTC-ZEON`;
                js_request(`https://tradebtc.zeonhexalgo.fun/api/v1/public/getmarketsummary?market=${coin_up[0]}-${coin_up[1]}`, res => exdata.fillj(res["result"], "Last", "Volume", "Ask", "Bid", ""));
                break;
            }
            case "moondex": {
                exdata.link = `https://dex.moondex.org/market/${coin_up[1]}-${coin_up[0]}`;
                js_request(`https://dex.moondex.org/api/v1/public/getmarketsummary?market=${coin_up[1]}-${coin_up[0]}`, res => exdata.fillj(res["result"], "Last", "Volume", "Ask", "Bid", ""));
                break;
            }
            case "delion": {
                exdata.link = `https://dex.delion.online/market/DELION.${coin_up[0]}_DELION.${coin_up[1]}`;
                js_request(`https://api.delion.online/public/v1/tickers/${coin_up[0]}_${coin_up[1]}`, res => {
                        res = res[`${coin_up[0]}_${coin_up[1]}`];
                        exdata.fill(res.latest, res.base_volume, res.lowest_ask, res.highest_bid, res.percent_change * 100);
                });
                break;
            }
            case "citex": {
                exdata.link = `https://www.citex.co.kr/#/trade/${coin_up[0]}_${coin_up[1]}`;
                js_request(`https://api.citex.co.kr/v1/markets/common/ticker`, res => {
                    tmp = res.find(x => x.symbol === `${coin_up[0]}_${coin_up[1]}`);
                    exdata.fill(tmp["lastPrice"], tmp["volume"]*tmp["lastPrice"], null, null, tmp["ratio"]*100);
                });
                break;
            }
            case "birake": {
                exdata.link = `https://trade.birake.com/market/BIRAKE.${coin_up[0]}_BIRAKE.${coin_up[1]}`;
                js_request(`https://api.birake.com/public/v3/ticker`, res => {
                        tmp = res.find(x => x.tradingPairs  === `${coin_up[0]}_${coin_up[1]}`);
                        exdata.fill(tmp.lastPrice, tmp.quoteVolume24h, tmp.lowestAsk, tmp.highestBid, tmp.baseVolume24h * 100);
                });
                break;
            }
            case "unnamedexchange": {
                exdata.link = `https://www.unnamed.exchange/Exchange/Basic?market=${coin_up[0]}_${coin_up[1]}`;
                js_request(`https://api.unnamed.exchange/v1/Public/Ticker?market=${coin_up[0]}_${coin_up[1]}`, res => exdata.fillj(res, "close", "volume", "lowestSell", "highestBuy", "change"));
                break;
            }
            case "nlexchange": {
                exdata.link = `https://www.nlexch.com/markets/${coin_lw[0]}${coin_lw[1]}`;
                js_request(`https://www.nlexch.com/api/v2/tickers/${coin_lw[0]}${coin_lw[1]}`, res => exdata.fillj(res["ticker"], "last", "vol", "sell", "buy", "change"));
                break;
            }
            case "swiftex": {
                exdata.link = `https://www.swiftex.co/trading/${coin_lw[0]}${coin_lw[1]}`;
                js_request(`https://www.swiftex.co/api/v2/peatio/public/markets/${coin_lw[0]}${coin_lw[1]}/tickers`, res => exdata.fillj(res["ticker"], "last", "volume", "sell", "buy", "price_change_percent"));
                break;
            }
            case "ihostmn_buy&sell": {
                exdata.link = `https://ihostmn.com/buysell.php?market=${coin_up[1]}${coin_up[0]}`;
                js_request(`https://ihostmn.com/api/v1/buysell/public/get_market_info?market=${coin_up[1]}${coin_up[0]}`, res => {
                        tmp = res["result"]["market"];
                        exdata.fill(tmp["last_price"], tmp["24h_volume"], tmp["sell"], tmp["buy"], '');
                });
                break;
            }
            case "tradecx": {
                exdata.link = `https://tradecx.io/markets/${coin_lw[0]}${coin_lw[1]}`;
                js_request(`https://tradecx.io/api/tickers/${coin_lw[0]}${coin_lw[1]}`, res => exdata.fillj(res["ticker"], "last", "vol", "sell", "buy", "change"));
                break;
            }
            case "nortexchange": {
                exdata.link = `https://nortexchange.com/exchange/?market=${coin_up[0]}_${coin_up[1]}`;
                js_request(`https://nortexchange.com/exchange/api?method=singlemarket=${coin_up[0]}_${coin_up[1]}`, res => exdata.fillj(res["market"], "last", "vol", "sell", "buy", "change"));
                break;
            }
            case "tradeogre": {
                exdata.link = `https://tradeogre.com/exchange/${coin_up[1]}-${coin_up[0]}`;
                js_request(`https://tradeogre.com/api/v1/ticker/${coin_up[1]}-${coin_up[0]}`, res => exdata.fillj(res,"price" ,"volume", "ask" , "bid" , "" ));  //  change not supported
                break;
            }
            case "hitbtc": {
                exdata.link = `https://hitbtc.com/${coin_up[0]}-to-${coin_up[1]}`;
                js_request(`https://api.hitbtc.com/api/2/public/ticker/${coin_up[0]}${coin_up[1]}`, res => exdata.fillj(res, "last", "volumeQuote", "ask", "bid", "")); // change not supported
                break;
            }
            case "yobit": {
                exdata.link = `https://yobit.net/en/trade/${coin_up[0]}/${coin_up[1]}`;
                js_request(`https://yobit.net/api/2/${coin_lw[0]}_${coin_lw[1]}/ticker`, res => exdata.fillj(res["ticker"], "last", "vol", "buy", "sell", "")); // change not supported
                break;
            }
            case "bittrex": {
                exdata.link = `https://www.bittrex.com/Market/Index?MarketName=${coin_up[1]}-${coin_up[0]}`;
                js_request(`https://bittrex.com/api/v1.1/public/getmarketsummary?market=${coin_lw[1]}-${coin_lw[0]}`, res => {
                    tmp = res["result"][0];
                    exdata.fill(tmp["Last"], tmp["BaseVolume"], tmp["Bid"], tmp["Ask"], tmp["Last"] / tmp["PrevDay"]); // change not 100% accurate
                });
                break;
            }
            case "southxchange": {
                exdata.link = `https://www.southxchange.com/Market/Book/${coin_up[0]}/${coin_up[1]}`;
                js_request(`https://www.southxchange.com/api/price/${coin_up[0]}/${coin_up[1]}`, res => exdata.fillj(res, "Last", "Volume24Hr", "Bid", "Ask", "Variation24Hr"));
                break;
            }
            case "exrates": {
                exdata.link = `https://exrates.me/dashboard`; // no filter
                js_request(`https://exrates.me/openapi/v1/public/ticker?currency_pair=${coin_lw[0]}_${coin_lw[1]}`, res => exdata.fillj(res[0], "last", "quoteVolume", "highestBid", "lowestAsk", "percentChange"));
                break;
            }
            case "midex": { // birake based
                exdata.link = `https://esbc.pro/link/exchange/midex`;//`https://dex.midas.investments/market/BIRAKE.${coin_up[0]}_BIRAKE.${coin_up[1]}`;
                js_request(`https://api.birake.com/public/ticker/`, res => exdata.fillj(res.find(x => x.base === coin_up[1] && x.quote === coin_up[0]), "latest", "base_volume", "highest_bid", "lowest_ask", "percent_change"));
                break;
            }
            case "binance": {
                exdata.link = `https://www.binance.com/es/trade/${coin_up[0]}_${coin_up[1]}`;
                js_request(`https://api.binance.com/api/v1/ticker/24hr?symbol=${coin_up[0]}${coin_up[1]}`, res => exdata.fillj(res, "lastPrice", "quoteVolume", "bidPrice", "askPrice", "priceChangePercent"));
                break;
            }
            case "bitfinex": {
                exdata.link = `https://www.bitfinex.com/t/${coin_up[0]}:${coin_up[1]}`;
                // [bid, bidsize, ask, asksize, daychg, daychg%, last, vol, high, low]
                js_request(`https://api.bitfinex.com/v2/ticker/t${coin_up[0]}${coin_up[1]}`, res => exdata.fill(res[6], (res[8] + res[9]) / 2 * res[7], res[0], res[2], res[5])); // volume not 100% accurate
                break;
            }
            case "coinex": {
                exdata.link = `https://www.coinex.com/exchange?currency=${coin_lw[1]}&dest=${coin_lw[0]}#limit`;
                js_request(`https://api.coinex.com/v1/market/ticker?market=${coin_up[0]}${coin_up[1]}`, res => {
                    tmp = res["data"]["ticker"];
                    exdata.fill(tmp["last"], (parseFloat(tmp["high"]) + parseFloat(tmp["low"])) / 2 * tmp["vol"], tmp["buy"], tmp["sell"], tmp["last"] / tmp["open"]); // volume not 100% accurate
                });
                break;
            }
            case "p2pb2b": {
                exdata.link = `https://p2pb2b.io/trade/${coin_up[0]}_${coin_up[1]}`;
                js_request(`https://p2pb2b.io/api/v1/public/ticker?market=${coin_up[0]}_${coin_up[1]}`, res => exdata.fillj(res["result"], "last", "deal", "bid", "ask", "change"));
                break;
            }
            case "coinsbit": {
                exdata.link = `https://coinsbit.io/trade/${coin_up[0]}_${coin_up[1]}`;
                js_request(`https://coinsbit.io/api/v1/public/ticker?market=${coin_up[0]}_${coin_up[1]}`, res => exdata.fillj(res["result"], "last", "deal", "bid", "ask", "change"));
                break;
            }
            case "tradesatoshi": {
                exdata.link = `https://tradesatoshi.com/Exchange/?market=${coin_up[0]}_${coin_up[1]}`;
                js_request(`https://tradesatoshi.com/api/public/getmarketsummary?market=${coin_up[0]}_${coin_up[1]}`, res => exdata.fillj(res.result, "last", "baseVolume", "ask", "bid", "change"));
                break;
            }
            case "coinbene": {
                exdata.link = `https://www.coinbene.com/exchange.html#/exchange?pairId=${coin_up[0]}${coin_up[1]}`;
                js_request(`https://api.coinbene.com/v1/market/ticker?symbol=${coin_lw[0]}${coin_lw[1]}`, res => exdata.fillj(res.ticker[0], "last", "24hrAmt", "ask", "bid", "")); // not supported change
                break;
	    }
	    case "finexboxnew": {
	        exdata.link = `https://www.finexbox.com/market/pair/${coin_up[0]}-${coin_up[1]}.html`;
	        Promise.all([
			async_request(`https://xapi.finexbox.com/v1/ticker?market=${coin_lw[0]}_${coin_lw[1]}`).catch(() => { }),
			async_request(`https://xapi.finexbox.com/v1/orders?market=${coin_lw[0]}_${coin_lw[1]}&count=1`).catch(() => { })
		]).then(([res, ord]) => {
			try {
				res = JSON.parse(res).result;
				exdata.set("price", res.price);
				exdata.set("volume", res.volume * res.average);
			}
			catch (e) { /**/ }
			try {
				ord = JSON.parse(ord).result;
				exdata.set("buy", ord.buy.length && ord.buy[0].price);
				exdata.set("sell", ord.sell.length && ord.sell[0].price);
			}
			catch (e) { /**/ }
			exdata.change = undefined;
			resolve(exdata); // volume not 100% accurate, 24h change not supported
		});
		break;
	    }
            case "finexboxold": {
                exdata.link = `https://www.finexbox.com/market/pair/${coin_up[0]}-${coin_up[1]}.html`;
                js_request(`https://xapi.finexbox.com/v1/ticker?market=${coin_up[0]}_${coin_up[1]}`, res => exdata.fillj(res["result"], "price", "volume", "high", "low", "percent"));
                break;
            }
            case "cryptohubexchange": {
                exdata.link = `https://cryptohubexchange.com/market/${coin_up[0]}/${coin_up[1]}/`;
                js_request(`https://cryptohubexchange.com/api/market/ticker/${coin_up[0]}/`, res => exdata.fillj(res[`${coin_up[1]}_${coin_up[0]}`], "last", "baseVolume", "lowestAsk", "highestBid", "percentChange"));
                break;
            }
            case "altmarkets": {
                exdata.link = `https://altmarkets.io/trading/${coin_lw[0]}${coin_lw[1]}`;
                js_request(`https://altmarkets.io/api/v2/tickers/${coin_lw[0]}${coin_lw[1]}`, res => exdata.fillj(res.ticker, "last", "quotevol", "sell", "buy", "")); // not supported change
                break;
            }
            case "nanuexchange": {
                exdata.link = `https://nanu.exchange/exchange#${coin_lw[0]}_${coin_lw[1]}`;
                js_request(`https://nanu.exchange/public?command=returnTicker&currencyPair=${coin_up[1]}_${coin_up[0]}`, res => exdata.fillj(res, "last", "baseVolume", "highestBid", "lowestAsk", "percentChange"));
                break;
            }
            case "vinex": {
                exdata.link = `https://vinex.network/market/${coin_up[0]}_${coin_up[1]}`;
                js_request(`https://api.vinex.network/api/v2/get-ticker?market=${coin_up[1]}_${coin_up[0]}`, res => exdata.fillj(res["data"], "lastPrice", "baseVolume", "askPrice", "bidPrice", "change24h"));
                break;
            }
            case "safetrade": {
                exdata.link = `https://safe.trade/trading/${coin_lw[0]}${coin_lw[1]}`;
                js_request(`https://safe.trade/api/v2/peatio/public/markets/${coin_lw[0]}${coin_lw[1]}/tickers`, res => exdata.fillj(res["ticker"], "last", "vol", "sell", "buy", "price_change_percent"));
                break;
            }
            case "tokok": {
                exdata.link = `https://www.tokok.com/market?symbol=${coin_up[0]}_${coin_up[1]}`;
                js_request(`https://www.tokok.com/api/v1/ticker?symbol=${coin_lw[0]}_${coin_lw[1]}`, res => exdata.fillj(res["ticker"], "last", "vol", "sell", "buy", ""));
                break;
            }
            case "vindax": {
                exdata.link = `https://vindax.com/exchange-base.html?symbol=${coin_up[0]}_${coin_up[1]}`;
                js_request(`https://api.vindax.com/api/v1/ticker/24hr?symbol=${coin_up[0]}${coin_up[1]}`, res => exdata.fillj(res, "lastPrice", "volume", "askPrice", "bidPrice", "priceChangePercent"));
                break;
            }
            case "gjcom": {
                exdata.link = `https://www.gj.com/trade/${coin_lw[0]}_${coin_lw[1]}`;
                js_request(`https://api.vindax.com/api/v1/ticker/24hr?symbol=${coin_up[0]}${coin_up[1]}`, res => exdata.fillj(res, "lastPrice", "volume", "askPrice", "bidPrice", "priceChangePercent"));
                break;
            }
            case "stakecube": {
                exdata.link = `https://stakecube.net/app/exchange/${coin_up[1]}-${coin_up[0]}`;
                js_request(`https://stakecube.net/app/api/v1/exchange/tickers?base=${coin_up[1]}&target=${coin_up[0]}`, res => exdata.fillj(res[0], "last_price", "volume", "ask", "bid", "percentChange"));
                break;
            }
            case "livecoin": {
                exdata.link = `https://www.livecoin.net/en/trading/${coin_up[0]}/${coin_up[1]}`;
                js_request(`https://api.livecoin.net/exchange/ticker?currencyPair=${coin_up[0]}/${coin_up[1]}`, res => exdata.fillj(res, "last", "volume", "best_ask", "best_bid", "vwap"));
                break;
            }
            default: {
                resolve(exdata);
            }
        }
        
    });
}

function price_avg() {
    return new Promise((resolve, reject) => {
        let promises = [];
        for (let ticker of conf.ticker.filter(x => !Array.isArray(x) || x[2].toUpperCase() === "BTC"))
            promises.push(get_ticker(ticker));
        Promise.all(promises).then(values => {
            let price = 0.00, weight = 0.00;
            values = values.filter(x => !isNaN(x.price));
            values.forEach(x => {
                x.volume = isNaN(x.volume) ? 0 : parseFloat(x.volume);
                weight += x.volume;
            });
            values.forEach(x => price += parseFloat(x.price) * (weight !== 0 ? x.volume / weight : 1 / values.length));
            resolve(values.length === 0 ? undefined : price);
        });
    });
}

function price_btc_usd() {
    return new Promise((resolve, reject) => {
        let req = new XMLHttpRequest();
        req.open("GET", "https://min-api.cryptocompare.com/data/price?fsym=BTC&tsyms=USD");
        req.onreadystatechange = () => {
            if (req.readyState === 4) {
                if (req.status === 200) {
                    try {
                        resolve(JSON.parse(req.responseText)["USD"]);
                    }
                    catch (e) { /**/ }
                }
                resolve(0);
            }
        };
        req.send();
    });
}

function request_mncount() {
    let cmd_res = bash_cmd(conf.requests.mncount);
    try {
        let json = JSON.parse(cmd_res);
        if (json["enabled"] !== undefined)
            return json["enabled"].toString();
    }
    catch (e) { /**/ }
    cmd_res = cmd_res.toString().replace("\n", "").trim();
    return /^[0-9]+$/.test(cmd_res) ? cmd_res : "";
}

function request_mncount1() {
    let cmd_res = bash_cmd(conf.requests.mncount1);
    try {
        let json = JSON.parse(cmd_res);
         
        if (json["basic-enabled"] !== undefined)
            return json["basic-enabled"].toString();
    }
    catch (e) { /**/ }
    cmd_res = cmd_res.toString().replace("\n", "").trim();
    return /^[0-9]+$/.test(cmd_res) ? cmd_res : "";
}

function request_mncount2() {
    let cmd_res = bash_cmd(conf.requests.mncount2);
    try {
        let json = JSON.parse(cmd_res);

        if (json["super-enabled"] !== undefined)
            return json["super-enabled"].toString();
    }
    catch (e) { /**/ }
    cmd_res = cmd_res.toString().replace("\n", "").trim();
    return /^[0-9]+$/.test(cmd_res) ? cmd_res : "";
}

function request_mncount3() {
    let cmd_res = bash_cmd(conf.requests.mncount3);
    try {
        let json = JSON.parse(cmd_res);

        if (json["bamf-enabled"] !== undefined)
            return json["bamf-enabled"].toString();
    }
    catch (e) { /**/ }
    cmd_res = cmd_res.toString().replace("\n", "").trim();
    return /^[0-9]+$/.test(cmd_res) ? cmd_res : "";
}

function valid_request(req) {
    return conf.requests[req] !== undefined && conf.requests[req].trim() !== "";
}

function earn_fields(coinday, avgbtc, priceusd) {
    const earn_value = (mult) => {
        return (coinday * mult).toFixed(4) + " " + conf.coin + "\n" +
            (coinday * mult * avgbtc).toFixed(8) + " BTC\n" +
            (coinday * mult * avgbtc * priceusd).toFixed(2) + " USD";
    };
    return [
        {
            name: "Daily",
            value: earn_value(1),
            inline: true
        },
        {
            name: "Weekly",
            value: earn_value(7),
            inline: true
        },
        {
            name: "Monthly",
            value: earn_value(30),
            inline: true
        },
        {
            name: "Yearly",
            value: earn_value(365),
            inline: true
        }
    ];
}

function earn_fields_M(coinday, avgbtc, priceusd) {
    const earn_value = (mult) => {
        return (coinday * mult).toFixed(4) + " " + conf.coin + "\n" +
            (coinday * mult * avgbtc).toFixed(8) + " BTC\n" +
            (coinday * mult * avgbtc * priceusd).toFixed(2) + " USD";
    };
    return [
        {
            name: "Monthly",
            value: earn_value(30),
            inline: true
        },

    ];
}

function get_stage(blk) {
    for (let stage of conf.stages)
        if (blk <= stage.block)
            return stage;
    return conf.stages[conf.stages.length - 1];
}

function get_stage1(blk) {
    for (let stage of conf.stages1)
        if (blk <= stage.block)
            return stage;
    return conf.stages1[conf.stages1.length - 1];
}

function get_stage2(blk) {
    for (let stage of conf.stages2)
        if (blk <= stage.block)
            return stage;
    return conf.stages2[conf.stages2.length - 1];
}

function get_stage3(blk) {
    for (let stage of conf.stages3)
        if (blk <= stage.block)
            return stage;
    return conf.stages3[conf.stages3.length - 1];
}

function async_request(url) {
    return new Promise((resolve, reject) => {
        let req = new XMLHttpRequest();
        req.open("GET", url);
        req.onreadystatechange = () => {
            if (req.readyState === 4) {
                if (req.status === 200) {
                    try {
                        resolve(req.responseText);
                        return;
                    }
                    catch (e) { /**/ }
                }
                reject(req.statusText);
            }
        };
        req.send();
    });
}

function bash_cmd(cmd) {
    return (process.platform === "win32" ? spawnSync("cmd.exe", ["/S", "/C", cmd]) : spawnSync("sh", ["-c", cmd])).stdout.toString();
}

function create_no_exists(path, file = false) {
    if (!fs.existsSync(path)) {
        if (file)
            fs.writeFileSync(path, "");
        else
            fs.mkdirSync(path);
    }
}

function simple_message(title, descr, color = conf.color.explorer) {
    return {
        embed: {
            title: title,
            color: color,
            description: descr,
            timestamp: new Date()
        }
    };
}

class BotCommand {

    /** @param {Discord.Message} msg - 
      * @param {Function} fn_send - */
    constructor(msg, fn_send = txt => this.msg.channel.send(txt)) {
        this.msg = msg;
        this.fn_send = fn_send;
    }

    price() {
        let promises = [];
        for (let ticker of conf.ticker)
            promises.push(get_ticker(ticker));

        return Promise.all(promises).then(values => {

            const hide_undef = (str, val) => {
                if (val === undefined)
                    return conf.hidenotsupported ? "\n" : str + "Not Supported" + "\n";
                return str + val + "\n";
            };

            let embed = new Discord.RichEmbed();
            embed.title = "Price Ticker";
            embed.color = conf.color.prices;
            embed.timestamp = new Date();

            for (let data of values) {
                embed.addField(
                    data.name,
                    hide_undef("**| Price** : ", data.price) +
                    hide_undef("**| Vol** : ", data.volume + " **ZEL**") +
                    hide_undef("**| Buy** : ", data.buy) +
                    hide_undef("**| Sell** : ", data.sell) +
                    hide_undef("**| Chg** : ", data.change) +
                    "[Link](" + data.link + ")",
                    true
                );
            }

            if (embed.fields.length > 3 && embed.fields.length % 3 === 2) // fix bad placing if a row have 2 tickers
                embed.addBlankField(true);

            this.fn_send(embed);
          });
        }
    
    stats() {
        return Promise.all([
            new Promise((resolve, reject) => resolve(bash_cmd(conf.requests.blockcount))),
            new Promise((resolve, reject) => resolve(request_mncount())),
            new Promise((resolve, reject) => resolve(bash_cmd(conf.requests.supply)))
        ]).then(([blockcount, mncount, supply]) => {
            
            let valid = {
                blockcount: !isNaN(blockcount) && blockcount.trim() !== "",
                mncount: !isNaN(mncount) && mncount.trim() !== "",
                supply: !isNaN(supply) && supply.trim() !== ""
            };

            let stage = get_stage(blockcount);
            let stg_index = conf.stages.indexOf(stage);

            let embed = new Discord.RichEmbed();
            embed.title = conf.coin + " Stats";
            embed.color = conf.color.coininfo;
            embed.timestamp = new Date();

            for (let stat of conf.statorder) {
                switch (stat) {
                    case "blockcount": {
                        if (valid.blockcount)
                            embed.addField("Block Count", blockcount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","), true);
                        break;
                    }
                    case "mncount": {
                        if (valid.mncount)
                            embed.addField("MN Count", mncount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","), true);
                        break;
                    }
                    case "supply": { 
                        if (valid.supply)
                            embed.addField("Supply", parseFloat(supply).toFixed(4).replace(/(\d)(?=(?:\d{3})+(?:\.|$))|(\.\d{4}?)\d*$/g, (m, s1, s2) => s2 || s1 + ',') + " " + conf.coin, true);
                        break;
                    }
                    case "collateral": { 
                        if (valid.blockcount)
                            embed.addField("Collateral", stage.coll.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " " + conf.coin, true);
                        break;
                    }
                    case "mnreward": { 
                        if (valid.blockcount)
                            embed.addField("MN Reward", stage.mn + " " + conf.coin, true);
                        break;
                    }
                    case "powreward": { 
                        if (stage.pow !== undefined && valid.blockcount)
                            embed.addField("POW Reward", stage.pow + " " + conf.coin, true);
                        break;
                    }
                    case "posreward": {
                        if (stage.pos !== undefined && valid.blockcount)
                            embed.addField("POS Reward", stage.pos + " " + conf.coin, true);
                        break;
                    }
                    case "locked": { 
                        if (valid.blockcount && valid.mncount && valid.supply)
                            embed.addField("Locked", (mncount * stage.coll).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " " + conf.coin + " (" + (mncount * stage.coll / supply * 100).toFixed(2) + "%)", true);
                        break;
                    }
                    case "avgmnreward": {
                        if (valid.mncount)
                            embed.addField("Avg. MN Reward", parseInt(mncount / (86400 / conf.blocktime)) + "d " + parseInt(mncount / (3600 / conf.blocktime) % 24) + "h " + parseInt(mncount / (60 / conf.blocktime) % 60) + "m", true);
                        break;
                    }
                    case "1stmnreward": {
                        let x3mncount = mncount * 3;
                        if (valid.mncount)
                            embed.addField("1st MN Reward", parseInt(x3mncount / (86400 / conf.blocktime)) + "d " + parseInt(x3mncount / (3600 / conf.blocktime) % 24) + "h " + parseInt(x3mncount / (60 / conf.blocktime) % 60) + "m", true);
                        break;
                    }
                    case "nextstage": { 
                        if (valid.blockcount)
                            embed.addField("Next Stage", parseInt((conf.stages[stg_index].block - blockcount) / (86400 / conf.blocktime)) + "d " + parseInt((conf.stages[stg_index].block - blockcount) / (3600 / conf.blocktime) % 24) + "h " + parseInt((conf.stages[stg_index].block - blockcount) / (60 / conf.blocktime) % 60) + "m", true);
                        break;
                    }
                    case "": {
                        embed.addBlankField(true);
                        break;
                    }
                }
            }
            
            if (valid_request("blockcount") && !valid.blockcount)
                embed.description = (embed.description === undefined ? "" : embed.description) + "There seems to be a problem with the `blockcount` request\n";
            if (valid_request("mncount") && !valid.mncount)
                embed.description = (embed.description === undefined ? "" : embed.description) + "There seems to be a problem with the `mncount` request\n";
            if (valid_request("supply") && !valid.supply)
                embed.description = (embed.description === undefined ? "" : embed.description) + "There seems to be a problem with the `supply` request";

            this.fn_send(embed);

        });
    }

    stats1() {
        return Promise.all([
            new Promise((resolve, reject) => resolve(bash_cmd(conf.requests.blockcount))),
            new Promise((resolve, reject) => resolve(request_mncount1())),
            new Promise((resolve, reject) => resolve(bash_cmd(conf.requests.supply)))
        ]).then(([blockcount, mncount1, supply]) => {
            
            let valid = {
                blockcount: !isNaN(blockcount) && blockcount.trim() !== "",
                mncount1: !isNaN(mncount1) && mncount1.trim() !== "",
                supply: !isNaN(supply) && supply.trim() !== ""
            };

            let stage = get_stage1(blockcount);
            let stg_index = conf.stages1.indexOf(stage);

            let embed = new Discord.RichEmbed();
            embed.title = conf.coin + " Stats Level Basic";
            embed.color = conf.color.basic;
            embed.timestamp = new Date();

            for (let stat of conf.statorder) {
                switch (stat) {
                    case "blockcount": {
                        if (valid.blockcount)
                            embed.addField("Block Count", blockcount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","), true);
                        break;
                    }
                    case "mncount": {
                        if (valid.mncount1)
                            embed.addField("MN Count Basic", mncount1.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","), true);
                        break;
                    }
                    case "supply": { 
                        if (valid.supply)
                            embed.addField("Supply", parseFloat(supply).toFixed(4).replace(/(\d)(?=(?:\d{3})+(?:\.|$))|(\.\d{4}?)\d*$/g, (m, s1, s2) => s2 || s1 + ',') + " " + conf.coin, true);
                        break;
                    }
                    case "collateral": { 
                        if (valid.blockcount)
                            embed.addField("Collateral", stage.coll.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " " + conf.coin, true);
                        break;
                    }
                    case "mnreward": { 
                        if (valid.blockcount)
                            embed.addField("MN Reward", stage.mn + " " + conf.coin, true);
                        break;
                    }
                    case "powreward": { 
                        if (stage.pow !== undefined && valid.blockcount)
                            embed.addField("POW Reward", stage.pow + " " + conf.coin, true);
                        break;
                    }
                    case "posreward": {
                        if (stage.pos !== undefined && valid.blockcount)
                            embed.addField("POS Reward", stage.pos + " " + conf.coin, true);
                        break;
                    }
                    case "locked": { 
                        if (valid.blockcount && valid.mncount1 && valid.supply)
                            embed.addField("Locked", (mncount1 * stage.coll).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " " + conf.coin + " (" + (mncount1 * stage.coll / supply * 100).toFixed(2) + "%)", true);
                        break;
                    }
                    case "avgmnreward": {
                        if (valid.mncount1)
                            embed.addField("Avg. MN Reward", parseInt(mncount1 / (86400 / conf.blocktime)) + "d " + parseInt(mncount1 / (3600 / conf.blocktime) % 24) + "h " + parseInt(mncount1 / (60 / conf.blocktime) % 60) + "m", true);
                        break;
                    }
                    case "1stmnreward": {
                        let x3mncount = mncount * 3;
                        if (valid.mncount)
                            embed.addField("1st MN Reward", parseInt(x3mncount / (86400 / conf.blocktime)) + "d " + parseInt(x3mncount / (3600 / conf.blocktime) % 24) + "h " + parseInt(x3mncount / (60 / conf.blocktime) % 60) + "m", true);
                        break;
                    }
                    case "nextstage": { 
                        if (valid.blockcount)
                            embed.addField("Next Stage", parseInt((conf.stages[stg_index].block - blockcount) / (86400 / conf.blocktime)) + "d " + parseInt((conf.stages[stg_index].block - blockcount) / (3600 / conf.blocktime) % 24) + "h " + parseInt((conf.stages[stg_index].block - blockcount) / (60 / conf.blocktime) % 60) + "m", true);
                        break;
                    }
                    case "": {
                        embed.addBlankField(true);
                        break;
                    }
                }
            }
            
            if (valid_request("blockcount") && !valid.blockcount)
                embed.description = (embed.description === undefined ? "" : embed.description) + "There seems to be a problem with the `blockcount` request\n";
            if (valid_request("mncount1") && !valid.mncount1)
                embed.description = (embed.description === undefined ? "" : embed.description) + "There seems to be a problem with the `mncount1` request\n";
            if (valid_request("supply") && !valid.supply)
                embed.description = (embed.description === undefined ? "" : embed.description) + "There seems to be a problem with the `supply` request";

            this.fn_send(embed);

        });
    }

    stats2() {
        return Promise.all([
            new Promise((resolve, reject) => resolve(bash_cmd(conf.requests.blockcount))),
            new Promise((resolve, reject) => resolve(request_mncount2())),
            new Promise((resolve, reject) => resolve(bash_cmd(conf.requests.supply)))
        ]).then(([blockcount, mncount2, supply]) => {

            let valid = {
                blockcount: !isNaN(blockcount) && blockcount.trim() !== "",
                mncount2: !isNaN(mncount2) && mncount2.trim() !== "",
                supply: !isNaN(supply) && supply.trim() !== ""
            };

            let stage = get_stage2(blockcount);
            let stg_index = conf.stages2.indexOf(stage);

            let embed = new Discord.RichEmbed();
            embed.title = conf.coin + " Stats Level Super";
            embed.color = conf.color.super1;
            embed.timestamp = new Date();

            for (let stat of conf.statorder) {
                switch (stat) {
                    case "blockcount": {
                        if (valid.blockcount)
                            embed.addField("Block Count", blockcount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","), true);
                        break;
                    }
                    case "mncount": {
                        if (valid.mncount2)
                            embed.addField("MN Count Super", mncount2.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","), true);
                        break;
                    }
                    case "supply": {
                        if (valid.supply)
                            embed.addField("Supply", parseFloat(supply).toFixed(4).replace(/(\d)(?=(?:\d{3})+(?:\.|$))|(\.\d{4}?)\d*$/g, (m, s1, s2) => s2 || s1 + ',') + " " + conf.coin, true);
                         break;
                    }
                    case "collateral": {
                        if (valid.blockcount)
                            embed.addField("Collateral", stage.coll.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " " + conf.coin, true);
                        break;
                    }
                    case "mnreward": {
                        if (valid.blockcount)
                            embed.addField("MN Reward", stage.mn + " " + conf.coin, true);
                        break;
                    }
                    case "powreward": {
                        if (stage.pow !== undefined && valid.blockcount)
                            embed.addField("POW Reward", stage.pow + " " + conf.coin, true);
                        break;
                    }
                    case "posreward": {
                        if (stage.pos !== undefined && valid.blockcount)
                            embed.addField("POS Reward", stage.pos + " " + conf.coin, true);
                        break;
                    }
                    case "locked": {
                        if (valid.blockcount && valid.mncount2 && valid.supply)
                            embed.addField("Locked", (mncount2 * stage.coll).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " " + conf.coin + " (" + (mncount2 * stage.coll / supply * 100).toFixed(2) + "%)", true);
                        break;
                    }
                    case "avgmnreward": {
                        if (valid.mncount2)
                            embed.addField("Avg. MN Reward", parseInt(mncount2 / (86400 / conf.blocktime)) + "d " + parseInt(mncount2 / (3600 / conf.blocktime) % 24) + "h " + parseInt(mncount2 / (60 / conf.blocktime) % 60) + "m", true);
                        break;
                    }
                    case "1stmnreward": {
                        let x3mncount = mncount * 3;
                        if (valid.mncount)
                            embed.addField("1st MN Reward", parseInt(x3mncount / (86400 / conf.blocktime)) + "d " + parseInt(x3mncount / (3600 / conf.blocktime) % 24) + "h " + parseInt(x3mncount / (60 / conf.blocktime) % 60) + "m", true);
                        break;
                    }
                    case "nextstage": {
                        if (valid.blockcount)
                            embed.addField("Next Stage", parseInt((conf.stages[stg_index].block - blockcount) / (86400 / conf.blocktime)) + "d " + parseInt((conf.stages[stg_index].block - blockcount) / (3600 / conf.blocktime) % 24) + "h " + parseInt((conf.stages[stg_index].block - blockcount) / (60 / conf.blocktime) % 60) + "m", true);
                        break;
                    }
                    case "": {
                        embed.addBlankField(true);
                        break;
                    }
                }
            }

            if (valid_request("blockcount") && !valid.blockcount)
                embed.description = (embed.description === undefined ? "" : embed.description) + "There seems to be a problem with the `blockcount` request\n";
            if (valid_request("mncount2") && !valid.mncount2)
                embed.description = (embed.description === undefined ? "" : embed.description) + "There seems to be a problem with the `mncount1` request\n";
            if (valid_request("supply") && !valid.supply)
                embed.description = (embed.description === undefined ? "" : embed.description) + "There seems to be a problem with the `supply` request";

            this.fn_send(embed);

        });
    }
     
    stats3() {
        return Promise.all([
            new Promise((resolve, reject) => resolve(bash_cmd(conf.requests.blockcount))),
            new Promise((resolve, reject) => resolve(request_mncount3())),
            new Promise((resolve, reject) => resolve(bash_cmd(conf.requests.supply)))
        ]).then(([blockcount, mncount3, supply]) => {

            let valid = {
                blockcount: !isNaN(blockcount) && blockcount.trim() !== "",
                mncount3: !isNaN(mncount3) && mncount3.trim() !== "",
                supply: !isNaN(supply) && supply.trim() !== ""
            };

            let stage = get_stage3(blockcount);
            let stg_index = conf.stages3.indexOf(stage);

            let embed = new Discord.RichEmbed();
            embed.title = conf.coin + " Stats Level Bamf"
            embed.color = conf.color.bamf;
            embed.timestamp = new Date();

            for (let stat of conf.statorder) {
                switch (stat) {
                    case "blockcount": {
                        if (valid.blockcount)
                            embed.addField("Block Count", blockcount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","), true);
                        break;
                    }
                    case "mncount": {
                        if (valid.mncount3)
                            embed.addField("MN Count Bamf", mncount3.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","), true);
                        break;
                    }
                    case "supply": {
                        if (valid.supply)
                            embed.addField("Supply", parseFloat(supply).toFixed(4).replace(/(\d)(?=(?:\d{3})+(?:\.|$))|(\.\d{4}?)\d*$/g, (m, s1, s2) => s2 || s1 + ',') + " " + conf.coin, true);
                         break;
                    }
                    case "collateral": {
                        if (valid.blockcount)
                            embed.addField("Collateral", stage.coll.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " " + conf.coin, true);
                        break;
                    }
                    case "mnreward": {
                        if (valid.blockcount)
                            embed.addField("MN Reward", stage.mn + " " + conf.coin, true);
                        break;
                    }
                    case "powreward": {
                        if (stage.pow !== undefined && valid.blockcount)
                            embed.addField("POW Reward", stage.pow + " " + conf.coin, true);
                        break;
                    }
                    case "posreward": {
                        if (stage.pos !== undefined && valid.blockcount)
                            embed.addField("POS Reward", stage.pos + " " + conf.coin, true);
                        break;
                    }
                    case "devfee": {
                        if (stage.devfee !== undefined && valid.blockcount)
                            embed.addField("DEV Fee", stage.devfee + " " + conf.coin, true);
                        break;
                    }
                    case "locked": {
                        if (valid.blockcount && valid.mncount3 && valid.supply)
                            embed.addField("Locked", (mncount3 * stage.coll).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " " + conf.coin + " (" + (mncount3 * stage.coll / supply * 100).toFixed(2) + "%)", true);
                        break;
                    }
                    case "avgmnreward": {
                        if (valid.mncount3)
                            embed.addField("Avg. MN Reward", parseInt(mncount3 / (86400 / conf.blocktime)) + "d " + parseInt(mncount3 / (3600 / conf.blocktime) % 24) + "h " + parseInt(mncount3 / (60 / conf.blocktime) % 60) + "m", true);
                        break;
                    }
                    case "1stmnreward": {
                        let x3mncount = mncount * 3;
                        if (valid.mncount)
                            embed.addField("1st MN Reward", parseInt(x3mncount / (86400 / conf.blocktime)) + "d " + parseInt(x3mncount / (3600 / conf.blocktime) % 24) + "h " + parseInt(x3mncount / (60 / conf.blocktime) % 60) + "m", true);
                        break;
                    }
                    case "nextstage": {
                        if (valid.blockcount)
                            embed.addField("Next Stage", parseInt((conf.stages[stg_index].block - blockcount) / (86400 / conf.blocktime)) + "d " + parseInt((conf.stages[stg_index].block - blockcount) / (3600 / conf.blocktime) % 24) + "h " + parseInt((conf.stages[stg_index].block - blockcount) / (60 / conf.blocktime) % 60) + "m", true);
                        break;
                    }
                    case "": {
                        embed.addBlankField(true);
                        break;
                    }
                }
            }

            if (valid_request("blockcount") && !valid.blockcount)
                embed.description = (embed.description === undefined ? "" : embed.description) + "There seems to be a problem with the `blockcount` request\n";
            if (valid_request("mncount3") && !valid.mncount3)
                embed.description = (embed.description === undefined ? "" : embed.description) + "There seems to be a problem with the `mncount3` request\n";
            if (valid_request("supply") && !valid.supply)
                embed.description = (embed.description === undefined ? "" : embed.description) + "There seems to be a problem with the `supply` request";

            this.fn_send(embed);

        });
    }
    
    stages() {
        return new Promise((resolve, reject) => resolve(bash_cmd(conf.requests.blockcount))).then(blockcount => {

            let embed = new Discord.RichEmbed();
            embed.title = conf.coin + " Stages";
            embed.color = conf.color.coininfo;
            embed.timestamp = new Date();

            if (isNaN(blockcount) && blockcount.trim() !== "") {
                embed.description = "There seems to be a problem with the `blockcount` request\n";
            }
            else {
                let stgindex = conf.stages.indexOf(get_stage(blockcount));
                for (let i = stgindex; i < conf.stages.length && embed.fields.length < 25; i++) {
                    let laststage = i > 0 ? conf.stages[i - 1] : { block: 0, coll: 0 };
                    let days = (laststage.block - blockcount) / (86400 / conf.blocktime);
                    embed.addField(
                        "Stage " + (i + 1) + " (" + (days < 0 ? "current)" : days.toFixed(2) + " days)"),
                        (laststage.block !== 0 && i !== stgindex ? "_Block:_ " + laststage.block + "\n" : "") +
                        (laststage.coll < conf.stages[i].coll && i !== stgindex ? "_New collateral:_ " + conf.stages[i].coll + "\n" : "") + 
                        (conf.stages[i].mn  !== undefined ? "_MN reward:_ "  + conf.stages[i].mn  + "\n" : "") + 
                        (conf.stages[i].pow !== undefined ? "_POW reward:_ " + conf.stages[i].pow + "\n" : "") +
                        (conf.stages[i].pos !== undefined ? "_POS reward:_ " + conf.stages[i].pos + "\n" : "") +
                        (conf.stages[i].devfee !== undefined ? "_DEV fee:_ " + conf.stages[i].devfee + "\n" : ""),
                        true
                    );
                }
            }

            if (embed.fields.length > 3 && embed.fields.length % 3 === 2) // fix bad placing if a row have 2 tickers
                embed.addBlankField(true);
            
            this.fn_send(embed);

        });
    }
    
    earnings(mns1 , mns2, mns3 ) {
        return Promise.all([
            new Promise((resolve, reject) => resolve(bash_cmd(conf.requests.blockcount))),
            new Promise((resolve, reject) => resolve(request_mncount1())),
            new Promise((resolve, reject) => resolve(request_mncount2())),
            new Promise((resolve, reject) => resolve(request_mncount3())),
	    new Promise((resolve, reject) => resolve(price_avg())),
            new Promise((resolve, reject) => resolve(price_btc_usd()))
        ]).then(([blockcount, mncount1, mncount2, mncount3, avgbtc, priceusd]) => {

            let valid = {
                blockcount: !isNaN(blockcount) && blockcount.trim() !== "",
                mncount1: !isNaN(mncount1) && mncount1.trim() !== "",
                mncount2: !isNaN(mncount2) && mncount2.trim() !== "",
                mncount3: !isNaN(mncount3) && mncount3.trim() !== ""
            };

            if (valid.blockcount && valid.mncount1  && valid.mncount2 && valid.mncount3 ) {
                mns1 = mns1 !== undefined && mns1 > 0 ? mns1 : 0;
		mns2 = mns2 !== undefined && mns2 > 0 ? mns2 : 0;
                mns3 = mns3 !== undefined && mns3 > 0 ? mns3 : 0;
    
                let stage1 = get_stage1(blockcount);
		let stage2 = get_stage2(blockcount);
                let stage3 = get_stage3(blockcount);
    
                let coinday1 = 86400 / conf.blocktime / mncount1 * stage1.mn;
                let coinday2 = 86400 / conf.blocktime / mncount2 * stage2.mn;
		let coinday3 = 86400 / conf.blocktime / mncount3 * stage3.mn;    

                this.fn_send({
                    embed: {
                        title: conf.coin + " Earnings " ,
                        color: conf.color.coininfo,
                        fields: [
            
                            {
                                name: "Basic",
                                value:  mns1 + " Mn(s)" ,
                                inline: true
                            },
                            {
                                name: "Super",
                                value:  mns2 + " Mn(s)"   ,
                                inline: true
                            },
                            {
                                name: "Bamf",
                                value: mns3 + " Mn(s)" ,
                                inline: true
                            },
                            
	         	            {
                                name: "ROI ",
                                value: (36500 / (stage1.coll / coinday1)).toFixed(2) + "%\n" + (stage1.coll / coinday1).toFixed(2) + " days",
                                inline: true
                            },
		                    {
                                name: "ROI ",
                                value: (36500 / (stage2.coll / coinday2)).toFixed(2) + "%\n" + (stage2.coll / coinday2).toFixed(2) + " days",
                                inline: true
                            },
		                    {
                                name: "ROI ",
                                value: (36500 / (stage3.coll / coinday3)).toFixed(2) + "%\n" + (stage3.coll / coinday3).toFixed(2) + " days",
                                inline: true
                            },
				
                            {
                                name: "MN Price ",
                                value: (stage1.coll * avgbtc).toFixed(8) + " BTC\n" + (stage1.coll * avgbtc * priceusd).toFixed(2) + " USD",
                                inline: true
                            },
			                {
                                name: "MN Price ",
                                value: (stage2.coll * avgbtc).toFixed(8) + " BTC\n" + (stage2.coll * avgbtc * priceusd).toFixed(2) + " USD",
                                inline: true
                            },
	                        {
                                name: "MN Price ",
                                value: (stage3.coll * avgbtc).toFixed(8) + " BTC\n" + (stage3.coll * avgbtc * priceusd).toFixed(2) + " USD",
                                inline: true
                            },
                            {
                                name: "Time to get 1 MN ",
                                value:  mns1 > 0 ? ((stage1.coll / (coinday1 * mns1)).toFixed(2) + " days") :  "----" ,
                                inline: true
                            },
                            {
                                name: "Time to get 1 MN ",
                                value:  mns2 > 0 ? ((stage2.coll / (coinday2 * mns2)).toFixed(2) + " days" ) : "----",
                                inline: true
                            },
                            {
                                name: "Time to get 1 MN ",
                                value:  mns3 > 0 ? ((stage3.coll / (coinday3 * mns3)).toFixed(2) + " days" ) : "----",
                                inline: true
                            }
		
           		
                        ].concat(earn_fields_M(coinday1 * mns1, avgbtc, priceusd)).concat(earn_fields_M(coinday2 * mns2, avgbtc, priceusd)).concat(earn_fields_M(coinday3 * mns3, avgbtc, priceusd)) ,
                        timestamp: new Date()
                    }
                });
            }
            else {
                this.fn_send({
                    embed: {
                        title: conf.coin + " Earnings",
                        color: conf.color.coininfo,
                        description: (valid.blockcount ? "" : "There seems to be a problem with the `blockcount` request\n") + (valid.mncount1 ? "" : "There seems to be a problem with the `mncount` request"),
                        timestamp: new Date()
                    }
                });
            }
        });
    }

    earnings1(mns) {
        return Promise.all([
            new Promise((resolve, reject) => resolve(bash_cmd(conf.requests.blockcount))),
            new Promise((resolve, reject) => resolve(request_mncount1())),
            new Promise((resolve, reject) => resolve(price_avg())),
            new Promise((resolve, reject) => resolve(price_btc_usd()))
        ]).then(([blockcount, mncount1, avgbtc, priceusd]) => {

            let valid = {
                blockcount: !isNaN(blockcount) && blockcount.trim() !== "",
                mncount1: !isNaN(mncount1) && mncount1.trim() !== ""
            };

            if (valid.blockcount && valid.mncount1) {
                mns = mns !== undefined && mns > 0 ? mns : 1;
                let stage = get_stage1(blockcount);
                let coinday = 86400 / conf.blocktime / mncount1 * stage.mn;
                this.fn_send({
                    embed: {

                        title: conf.coin + " Earnings Basic" + (mns !== 1 ? " (" + mns + " MNs)" : ""),
                        color: conf.color.basic,
                        fields: [
                            {
                                name: "ROI",
                                value: (36500 / (stage.coll / coinday)).toFixed(2) + "%\n" + (stage.coll / coinday).toFixed(2) + " days",
                                inline: true
                            },
                            {
                                name: "MN Price",
                                value: (stage.coll * avgbtc).toFixed(8) + " BTC\n" + (stage.coll * avgbtc * priceusd).toFixed(2) + " USD",
                                inline: true
                            }
                        ].concat(mns === 1 ? [{ name: "\u200b", value: "\u200b", inline: true }] : [
                            {
                                name: "Time to get 1 MN",
                                value: (stage.coll / (coinday * mns)).toFixed(2) + " days",
                                inline: true
                            }
                        ]).concat(earn_fields(coinday * mns, avgbtc, priceusd)),
                        timestamp: new Date()
                    }
                });
            }
            else {
                this.fn_send({
                    embed: {

                        title: conf.coin + " Earnings Basic",
                        color: conf.color.coininfo1,
                        description: (valid.blockcount ? "" : "There seems to be a problem with the `blockcount` request\n") + (valid.mncount1 ? "" : "There seems to be a problem with the `mncount` request"),
                        timestamp: new Date()
                    }
                });
            }
        });
    }

    earnings2(mns) {
        return Promise.all([
            new Promise((resolve, reject) => resolve(bash_cmd(conf.requests.blockcount))),
            new Promise((resolve, reject) => resolve(request_mncount2())),
            new Promise((resolve, reject) => resolve(price_avg())),
            new Promise((resolve, reject) => resolve(price_btc_usd()))
        ]).then(([blockcount, mncount2, avgbtc, priceusd]) => {

            let valid = {
                blockcount: !isNaN(blockcount) && blockcount.trim() !== "",
                mncount2: !isNaN(mncount2) && mncount2.trim() !== ""
            };

            if (valid.blockcount && valid.mncount2) {
                mns = mns !== undefined && mns > 0 ? mns : 1;
                let stage = get_stage2(blockcount);
                let coinday = 86400 / conf.blocktime / mncount2 * stage.mn;
                this.fn_send({
                    embed: {
                        title: conf.coin + " Earnings Super" + (mns !== 1 ? " (" + mns + " MNs)" : ""),
                        color: conf.color.super1,
                        fields: [
                            {
                                name: "ROI",
                                value: (36500 / (stage.coll / coinday)).toFixed(2) + "%\n" + (stage.coll / coinday).toFixed(2) + " days",
                                inline: true
                            },
                            {
                                name: "MN Price",
                                value: (stage.coll * avgbtc).toFixed(8) + " BTC\n" + (stage.coll * avgbtc * priceusd).toFixed(2) + " USD",
                                inline: true
                            }
                        ].concat(mns === 1 ? [{ name: "\u200b", value: "\u200b", inline: true }] : [
                            {
                                name: "Time to get 1 MN",
                                value: (stage.coll / (coinday * mns)).toFixed(2) + " days",
                                inline: true
                            }
                        ]).concat(earn_fields(coinday * mns, avgbtc, priceusd)),
                        timestamp: new Date()
                    }
                });
            }
            else {
                this.fn_send({
                    embed: {
                        title: conf.coin + " Earnings Super",
                        color: conf.color.coininfo2,
                        description: (valid.blockcount ? "" : "There seems to be a problem with the `blockcount` request\n") + (valid.mncount2 ? "" : "There seems to be a problem with the `mncount` request"),
                        timestamp: new Date()
                    }
                });
            }
        });
    }
    
    earnings3(mns) {
        return Promise.all([
            new Promise((resolve, reject) => resolve(bash_cmd(conf.requests.blockcount))),
            new Promise((resolve, reject) => resolve(request_mncount3())),
            new Promise((resolve, reject) => resolve(price_avg())),
            new Promise((resolve, reject) => resolve(price_btc_usd()))
        ]).then(([blockcount, mncount3, avgbtc, priceusd]) => {

            let valid = {
                blockcount: !isNaN(blockcount) && blockcount.trim() !== "",
                mncount3: !isNaN(mncount3) && mncount3.trim() !== ""
            };

            if (valid.blockcount && valid.mncount3) {
                mns = mns !== undefined && mns > 0 ? mns : 1;
                let stage = get_stage3(blockcount);
                let coinday = 86400 / conf.blocktime / mncount3 * stage.mn;
                this.fn_send({
                    embed: {
                        title: conf.coin + " Earnings Bamf" + (mns !== 1 ? " (" + mns + " MNs)" : ""),
                        color: conf.color.bamf,
                        fields: [
                            {
                                name: "ROI",
                                value: (36500 / (stage.coll / coinday)).toFixed(2) + "%\n" + (stage.coll / coinday).toFixed(2) + " days",
                                inline: true
                            },
                            {
                                name: "MN Price",
                                value: (stage.coll * avgbtc).toFixed(8) + " BTC\n" + (stage.coll * avgbtc * priceusd).toFixed(2) + " USD",
                                inline: true
                            }
                        ].concat(mns === 1 ? [{ name: "\u200b", value: "\u200b", inline: true }] : [
                            {
                                name: "Time to get 1 MN",
                                value: (stage.coll / (coinday * mns)).toFixed(2) + " days",
                                inline: true
                            }
                        ]).concat(earn_fields(coinday * mns, avgbtc, priceusd)),
                        timestamp: new Date()
                    }
                });
            }
            else {
                this.fn_send({
                    embed: {
                        title: conf.coin + " Earnings Bamf",
                        color: conf.color.coininfo3,
                        description: (valid.blockcount ? "" : "There seems to be a problem with the `blockcount` request\n") + (valid.mncount3 ? "" : "There seems to be a problem with the `mncount` request"),
                        timestamp: new Date()
                    }
                });
            }
        });
    }	
    
    mining(hr, mult) {
        let letter = "";

        const calc_multiplier = () => {
            if (mult !== undefined)
                switch (mult.toUpperCase()) {
                    case "K": case "KH": case "KHS": case "KH/S": case "KHASH": case "KHASHS": case "KHASH/S":
                        letter = "K";
                        return hr * 1000;
                    case "M": case "MH": case "MHS": case "MH/S": case "MHASH": case "MHASHS": case "MHASH/S":
                        letter = "M";
                        return hr * 1000 * 1000;
                    case "G": case "GH": case "GHS": case "GH/S": case "GHASH": case "GHASHS": case "GHASH/S":
                        letter = "G";
                        return hr * 1000 * 1000 * 1000;
                    case "T": case "TH": case "THS": case "TH/S": case "THASH": case "THASHS": case "THASH/S":
                        letter = "T";
                        return hr * 1000 * 1000 * 1000 * 1000;
                }
            return hr;
        };

        if (/^[0-9.\n]+$/.test(hr)) {
            Promise.all([
                new Promise((resolve, reject) => resolve(bash_cmd(conf.requests.blockcount))),
                new Promise((resolve, reject) => resolve(bash_cmd(conf.requests.hashrate))),
                new Promise((resolve, reject) => resolve(price_avg())),
                new Promise((resolve, reject) => resolve(price_btc_usd()))
            ]).then(([blockcount, total_hr, avgbtc, priceusd]) => {

                let valid = {
                    blockcount: !isNaN(blockcount) && blockcount.trim() !== "",
                    mncount: !isNaN(total_hr) && total_hr.trim() !== ""
                };

                if (valid.blockcount && valid.mncount) {
                    let stage = get_stage(blockcount);
                    let coinday = 86400 / conf.blocktime * stage.pow * calc_multiplier() / total_hr;
                    this.fn_send({
                        embed: {
                            title: conf.coin + " Mining (" + hr + " " + letter + "H/s)",
                            color: conf.color.coininfo,
                            description: stage.pow === undefined ? "POW disabled in the current coin stage" : "",
                            fields: stage.pow === undefined ? [] : earn_fields(coinday, avgbtc, priceusd),
                            timestamp: new Date()
                        }
                    });
                }
                else {
                    this.fn_send({
                        embed: {
                            title: conf.coin + " Mining (" + hr + " " + letter + "H/s)",
                            color: conf.color.coininfo,
                            description: (valid.blockcount ? "" : "There seems to be a problem with the `blockcount` request\n") + (valid.hashrate ? "" : "There seems to be a problem with the `hashrate` request"),
                            timestamp: new Date()
                        }
                    });
                }
            });
        }
        else {
            this.fn_send({
                embed: {
                    title: conf.coin + " Mining ( ? H/s)",
                    color: conf.color.coininfo,
                    description: "Invalid hashrate"
                }
            });
        }
    }   
    
    addnodes() {
        new Promise((resolve, reject) => resolve(bash_cmd(conf.requests.addnodes))).then(info => {
            try {
                let str = "";
                JSON.parse(info).slice(0, 16).forEach(x => str += `addnode=${x.addr}\n`);
                this.fn_send(simple_message(conf.coin + " addnodes", "```ini\n" + str + "\n```", conf.color.addnodes));
            }
            catch (e) {
                this.msg.send(simple_message("Addnodes", "There seems to be a problem with the `addnodes` request"));
            }
        });
    }
    
    balance(addr) {
        try {
            let json = JSON.parse(bash_cmd(conf.requests.balance + addr));
            if (json["totalSent"] !== undefined && json["totalReceived"] !== undefined && json["balance"] !== undefined) {
                this.fn_send({
                    embed: {
                        title: "Balance",
                        color: conf.color.explorer,
                        fields: [
                            {
                                name: "Address",
                                value: addr
                            },
                            {
                                name: "Sent",
                                value: json["totalSent"].toString().replace(/(\d)(?=(?:\d{3})+(?:\.|$))|(\.\d{4}?)\d*$/g, (m, s1, s2) => s2 || s1 + ',') + " " + conf.coin,
                                inline: true
                            },
                            {
                                name: "Received",
                                value: json["totalReceived"].toString().replace(/(\d)(?=(?:\d{3})+(?:\.|$))|(\.\d{4}?)\d*$/g, (m, s1, s2) => s2 || s1 + ',') + " " + conf.coin,
                                inline: true
                            },
                            {
                                name: "Balance",
                                value: json["balance"].toString().replace(/(\d)(?=(?:\d{3})+(?:\.|$))|(\.\d{4}?)\d*$/g, (m, s1, s2) => s2 || s1 + ',') + " " + conf.coin,
                                inline: true
                            }
                        ],
                        timestamp: new Date()
                    }
                });
                return;
            }
        }
        catch (e) { /**/ }
        this.fn_send(simple_message("Balance", "Invalid address: `" + addr + "`\n(Addresses that never received a single coin might be considered as invalid)"));
    }
    block_index(index) {
        this.block_hash(bash_cmd(conf.requests.blockindex + index));
    }
    block_hash(hash) {
        let str = "Invalid block index or hash";

        if (/^[A-Za-z0-9\n]+$/.test(hash)) {
            try {
                let json = JSON.parse(bash_cmd(conf.requests.blockhash + hash));
                str =
                    "**Index:** " + json["height"] + "\n" +
                    "**Hash:** " + json["hash"] + "\n" +
                    "**Confirmations:** " + json["confirmations"] + "\n" +
                    "**Size:** " + json["size"] + "\n" +
                    "**Date:** " + new Date(new Number(json["time"]) * 1000).toUTCString() + "\n" +
                    "**Prev Hash:** " + json["previousblockhash"] + "\n" +
                    "**Next Hash:** " + json["nextblockhash"] + "\n" +
                    "**Transactions:**\n";
                for (let i = 0; i < json["tx"].length; i++)
                    str += json["tx"][i] + "\n";
            }
            catch (e) { /**/ }
        }
        this.fn_send({
            embed: {
                title: "Block info",
                color: conf.color.explorer,
                description: str
            }
        });
    }

    my_address_add(addrs) {
        create_no_exists(users_addr_folder);
        for (let addr of addrs) {
            try {
                let json = JSON.parse(bash_cmd(conf.requests.balance + addr));
                if (json["totalSent"] !== undefined && json["totalReceived"] !== undefined && json["balance"] !== undefined) {
                    let addrs_list = fs.existsSync(users_addr_folder + "/" + this.msg.author.id + ".txt") ? fs.readFileSync(users_addr_folder + "/" + this.msg.author.id + ".txt", "utf8").split(/\r?\n/) : [];
                    if (addrs_list.indexOf(addr) === -1) {
                        fs.writeFileSync(users_addr_folder + "/" + this.msg.author.id + ".txt", addrs_list.concat([addr]).join("\n"));
                        this.fn_send(simple_message("User Address Add", "Address `" + addr + "` assigned to <@" + this.msg.author.id + ">"));
                    }
                    else {
                        this.fn_send(simple_message("User Address Add", "Address `" + addr + "` already has been assigned to <@" + this.msg.author.id + ">"));
                    }
                    continue;
                }
            }
            catch (e) { /**/ }
            this.fn_send(simple_message("User Address Add", "Invalid address: `" + addr + "`\n(Addresses that never received a single coin might be considered as invalid)"));
        }
    }
    
    my_address_del(addrs) {
        create_no_exists(users_addr_folder);
        for (let addr of addrs) {
            if (!fs.existsSync(users_addr_folder + "/" + this.msg.author.id + ".txt")) {
                this.fn_send(simple_message("User Address Delete", "There aren't addresses assigned to <@" + this.msg.author.id + ">"));
                return;
            }
            let addrs_list = fs.readFileSync(users_addr_folder + "/" + this.msg.author.id + ".txt", "utf8").split(/\r?\n/).filter(Boolean);
            let index = addrs_list.indexOf(addr);
            if (index !== -1) {
                addrs_list.splice(index, 1);
                if (addrs_list.length)
                    fs.writeFileSync(users_addr_folder + "/" + this.msg.author.id + ".txt", addrs_list.join("\n"));
                else
                    fs.unlinkSync(users_addr_folder + "/" + this.msg.author.id + ".txt");
                this.fn_send(simple_message("User Address Delete", "Address `" + addr + "` deleted from <@" + this.msg.author.id + "> assigned addresses"));
            }
            else {
                this.fn_send(simple_message("User Address Delete", "Address `" + addr + "` isn't assgined to <@" + this.msg.author.id + ">\nUse `" + conf.prefix + "my-address-list` to get your assigned addresses"));
            }
        }
    }
    
    my_address_list() {
        create_no_exists(users_addr_folder);
        if (!fs.existsSync(users_addr_folder + "/" + this.msg.author.id + ".txt")) {
            this.fn_send(simple_message("User Address List", "There aren't addresses assigned to <@" + this.msg.author.id + ">\nUse `" + conf.prefix + "my-address-add ADDRESS` to assign addresses to your account"));
            return;
        }

        let addr_str = "`" + fs.readFileSync(users_addr_folder + "/" + this.msg.author.id + ".txt", "utf8").split(/\r?\n/).filter(Boolean).join("`, `") + "`";
        if (addr_str.length < 2000) {
            this.fn_send(simple_message("User Address List", addr_str));
        }
        else {
            this.fn_send(simple_message("User Address List", "Address list too large, sent via dm"));
            this.msg.author.send(addr_str);
        }
    }
    
    my_balance() {
        create_no_exists(users_addr_folder);
        if (!fs.existsSync(users_addr_folder + "/" + this.msg.author.id + ".txt")) {
            this.fn_send(simple_message("User Balance", "There aren't addresses assigned to <@" + this.msg.author.id + ">\nUse `" + conf.prefix + "my-address-add ADDRESS` to assign addresses to your account"));
            return;
        }

        let sent = 0.00, recv = 0.00, bal = 0.00;
        for (let addr of fs.readFileSync(users_addr_folder + "/" + this.msg.author.id + ".txt", "utf-8").split(/\r?\n/).filter(Boolean)) {
            try {
                let json = JSON.parse(bash_cmd(conf.requests.balance + addr ));
                
                if (json["totalSent"] !== undefined && json["totalReceived"] !== undefined && json["balance"] !== undefined) {
                    sent += parseFloat(json["totalSent"]);
                    recv += parseFloat(json["totalReceived"]);
                    bal += parseFloat(json["balance"]);
                }
            }
            catch (e) {
                //
            }
        }
        this.fn_send({
            embed: {
                title: "User Balance",
                color: conf.color.explorer,
                fields: [
                    {
                        name: "Sent",
                        value: sent.toString().replace(/(\d)(?=(?:\d{3})+(?:\.|$))|(\.\d{4}?)\d*$/g, (m, s1, s2) => s2 || s1 + ',') + " " + conf.coin,
                        inline: true
                    },
                    {
                        name: "Received",
                        value: recv.toString().replace(/(\d)(?=(?:\d{3})+(?:\.|$))|(\.\d{4}?)\d*$/g, (m, s1, s2) => s2 || s1 + ',') + " " + conf.coin,
                        inline: true
                    },
                    {
                        name: "Balance",
                        value: bal.toString().replace(/(\d)(?=(?:\d{3})+(?:\.|$))|(\.\d{4}?)\d*$/g, (m, s1, s2) => s2 || s1 + ',') + " " + conf.coin,
                        inline: true
                    }
                ],
                timestamp: new Date()
            }
        });
    }

    my_masternode_add(addrs) {
        create_no_exists(users_mn_folder);
        for (let addr of addrs) {
            try {
                console.log(addr) ; 
                let json = JSON.parse(bash_cmd(conf.requests.mnstat + addr));
                if (Array.isArray(json))
                    json = json[0];

                  
                if (json["status"] !== undefined && json["addr"] === addr) {

                    console.log("here") ;

                    let addrs_list = fs.existsSync(users_mn_folder + "/" + this.msg.author.id + ".txt") ? fs.readFileSync(users_mn_folder + "/" + this.msg.author.id + ".txt", "utf8").split(/\r?\n/) : [];

                    console.log(addrs_list) ;
 
                    if (addrs_list.indexOf(addr) === -1) {
                        fs.writeFileSync(users_mn_folder + "/" + this.msg.author.id + ".txt", addrs_list.concat([addr]).join("\n"));
                        this.fn_send(simple_message("User Masternode Add", "Masternode address `" + addr + "` assigned to <@" + this.msg.author.id + ">\nStatus: " + json["status"]));
                    }
                    else {
                        this.fn_send(simple_message("User Masternode Add", "Masternode address `" + addr + "` already has been assigned to <@" + this.msg.author.id + ">"));
                    }
                }
            }
            catch (e) {
                this.fn_send(simple_message("User Masternode Add", "Invalid masternode address: `" + addr + "`\n(Can't be found in the masternode list)"));
            }
        }
    }
    
    my_masternode_del(addrs) {
        create_no_exists(users_mn_folder);
        for (let addr of addrs) {
            if (!fs.existsSync(users_mn_folder + "/" + this.msg.author.id + ".txt")) {
                this.fn_send(simple_message("User Masternode Delete", "There aren't masternode addresses assigned to <@" + this.msg.author.id + ">"));
                return;
            }
            let addrs_list = fs.readFileSync(users_mn_folder + "/" + this.msg.author.id + ".txt", "utf8").split(/\r?\n/).filter(Boolean);
            let index = addrs_list.indexOf(addr);
            if (index !== -1) {
                addrs_list.splice(index, 1);
                if (addrs_list.length)
                    fs.writeFileSync(users_mn_folder + "/" + this.msg.author.id + ".txt", addrs_list.join("\n"));
                else
                    fs.unlinkSync(users_mn_folder + "/" + this.msg.author.id + ".txt");
                this.fn_send(simple_message("User Masternode Delete", "Masternode address `" + addr + "` deleted from <@" + this.msg.author.id + "> assigned addresses"));
            }
            else {
                this.fn_send(simple_message("User Masternode Delete", "Masternode address `" + addr + "` isn't assgined to <@" + this.msg.author.id + ">\nUse `" + conf.prefix + "my-masternode-list` to get your assigned masternode addresses"));
            }
        }
    }
    
    my_masternode_list() {
        create_no_exists(users_mn_folder);
        if (!fs.existsSync(users_mn_folder + "/" + this.msg.author.id + ".txt")) {
            this.fn_send(simple_message("User Masternode List", "There aren't masternode addresses assigned to <@" + this.msg.author.id + ">\nUse `" + conf.prefix + "my-masternode-add ADDRESS` to assign masternodes to your account"));
            return;
        }

        let mn_str = "";

        for (let addr of fs.readFileSync(users_mn_folder + "/" + this.msg.author.id + ".txt", "utf8").split(/\r?\n/).filter(Boolean)) {
            mn_str += "`" + addr + "`";
            try {
                let json = JSON.parse(bash_cmd(conf.requests.mnstat + addr));
                if (Array.isArray(json))
                    json = json[0];
                if (json["status"] !== undefined && json["addr"] !== undefined)
                    mn_str += " : " + json["status"] + "\n";
            }
            catch (e) {
                mn_str += " : NOT_FOUND\n";
            }
        }

        if (mn_str.length < 2000) {
            this.fn_send(simple_message("User Masternode List", mn_str));
        }
        else {
            let mn_split = mn_str.split(/\r?\n/);
            let splits = parseInt(mn_split.length / 30) + 1;
            for (let i = 1; mn_split.length > 0; i++)
                this.fn_send(simple_message("User Masternode List (" + i + "/" + splits + ")", mn_split.splice(0, 30).join("\n")));
        }
    }
    
    my_earnings() {
        create_no_exists(users_mn_folder);
        if (!fs.existsSync(users_mn_folder + "/" + this.msg.author.id + ".txt")) {
            this.fn_send(simple_message("User Earnings", "There aren't masternode addresses assigned to <@" + this.msg.author.id + ">\nUse `" + conf.prefix + "my-masternode-add ADDRESS` to assign masternodes to your account"));
            return;
        }

        Promise.all([
            new Promise((resolve, reject) => resolve(bash_cmd(conf.requests.blockcount))),
            new Promise((resolve, reject) => resolve(request_mncount())),
            new Promise((resolve, reject) => resolve(price_avg())),
            new Promise((resolve, reject) => resolve(price_btc_usd()))
        ]).then(([blockcount, mncount, avgbtc, priceusd]) => {

            let valid = {
                blockcount: !isNaN(blockcount) && blockcount.trim() !== "",
                mncount: !isNaN(mncount) && mncount.trim() !== ""
            };

            let mns = fs.readFileSync(users_mn_folder + "/" + this.msg.author.id + ".txt", "utf-8").split(/\r?\n/).filter(Boolean).length;

            if (valid.blockcount && valid.mncount) {
                let stage = get_stage(blockcount);
                let coinday = 86400 / conf.blocktime / mncount * stage.mn;
                this.fn_send({
                    embed: {
                        title: "User Earnings (" + mns + " MNs)",
                        color: conf.color.coininfo,
                        fields: [
                            {
                                name: "Time to get 1 MN",
                                value: (stage.coll / (coinday * mns)).toFixed(2) + " days"
                            }
                        ].concat(earn_fields(coinday * mns, avgbtc, priceusd)),
                        timestamp: new Date()
                    }
                });
            }
            else {
                this.fn_send({
                    embed: {
                        title: "User Earnings (" + mns + " MNs)",
                        color: conf.color.coininfo,
                        description: (valid.blockcount ? "" : "There seems to be a problem with the `blockcount` request\n") + (valid.mncount ? "" : "There seems to be a problem with the `mncount` request"),
                        timestamp: new Date()
                    }
                });
            }
        });
    }

    help() {
        this.fn_send({
            embed: {
                title: "Available commands",
                color: conf.color.other,
                fields: [
                    {
                        name: "Exchanges:",
                        value:
                            " - **" + conf.prefix + "price" + "** : get the current price of " + conf.coin + " on every listed exchange"
                    },
                    {
                        name: "Coin Info:",
                        value:
                            " - **" + conf.prefix + "stats** : get the current stats of the " + conf.coin + " blockchain\n" +
                            
                            "   - **" + conf.prefix + "basic** : get the current Basic stats of the " + conf.coin + " blockchain\n" +
                            "   - **" + conf.prefix + "super** : get the current Super stats of the " + conf.coin + " blockchain\n" +
                            "   - **" + conf.prefix + "bamf** : get the current Bamf stats of the " + conf.coin + " blockchain\n" +
  
                            " - **" + conf.prefix + "stages** : get the info of the upcoming reward structures\n" +
                            " - **" + conf.prefix + "earnings [MN_Basic  MN_Super MN_Bamf]** : get the expected earnings per masternode, aditionally you can put the amount of MNs at each level\n" +
                            " - **" + conf.prefix + "earningsbasic [amount of MNs]** : get the expected earnings per masternode Basic\n" +
                            " - **" + conf.prefix + "earningssuper [amount of MNs]** : get the expected earnings per masternode Super\n" +
                            " - **" + conf.prefix + "earningsbamf  [amount of MNs]** : get the expected earnings per masternode Bamf\n" +
                            " - **" + conf.prefix + "addnodes** : get a addnodes list for the chain sync\n" +                      
                            " - **" + conf.prefix + "mining <hashrate> [K/M/G/T]** : get the expected earnings with the given hashrate, aditionally you can put the hashrate multiplier (K = KHash/s, M = MHash/s, ...)"
                    },
                    {
                        name: "Explorer",
                        value:
                            " - **" + conf.prefix + "balance <address>** : show the balance, sent and received of the given address\n" +
                            " - **" + conf.prefix + "block-index <number>** : show the info of the block by its index\n" +
                            " - **" + conf.prefix + "block-hash <hash>** : show the info of the block by its hash"
                    },
                    {
                        name: "User Address",
                        value:
                            " - **" + conf.prefix + "my-address-add <address>** : adds an address to your address list\n" +
                            " - **" + conf.prefix + "my-address-del <address>** : removes an address from your address list\n" +
                            " - **" + conf.prefix + "my-address-list** : show all your listed addresses\n" +
                            " - **" + conf.prefix + "my-balance** : shows your total balance, sent and received"
                    },
                    {
                        name: "User Masternode",
                        value:
                            " - **" + conf.prefix + "my-masternode-add <address>** : adds a masternode address to your address list\n" +
                            " - **" + conf.prefix + "my-masternode-del <address>** : removes a masternode address from your address list\n" +
                            " - **" + conf.prefix + "my-masternode-list** : show all your listed masternode addresses and their status\n" +
                            " - **" + conf.prefix + "my-earnings** : shows your total earnings"
                    },
                    {
                        name: "Other:",
                        value:
                            " - **" + conf.prefix + "help** : the command that you just used\n" +
                            " - **" + conf.prefix + "about** : know more about me :smirk:"
                    },
                    {
                        name: "Admins only:",
                        value:
                            " - **" + conf.prefix + "conf-get** : retrieve the bot config via dm\n" +
                            " - **" + conf.prefix + "conf-set** : set a new config to the bot via dm"
                    }
                ]
            }
        });
    }
    about() {
        const donate = { // don't be evil with this, please
            "BTC":	"1LqBf2ephKHFB1xYezoRjWG3or6TNA5NT1"
            "ZEL":	"t1h5ZGK8hupD6A3v8wHmUjPZdqUfLcyX28U"
            "RVN":	"RV7NjYY7J95pF2Kk8AnYq2bFa7Z3yFLdVG"
            "MON":	"MurYZ1KR2jTW5uBNiZvPcdzXkJXTt4WsjC"
            "AGM":	"MG4gQB6JaYDWvw6GBMZtfCjxWBjkmActxq"
            "INN": 	"i8jsXVFCTRUJucWxquSnqhJ5kMti2fJwhA"
            "LUX":	"LhQc7FwxFCGiYk688ukNyf9UgYj42wZ9hm"
            "BIR":	"KRZhzCqTpJycxK5oqDhxQv5jvdUE4m5aiq"
            "COW":	"CSJCyNzC3FUFWfiUsZoqAJQmkfjGBkvpij"
            "ZCR":	"zHR4iac4kCkvqjDZzF9x9JaG8wXR7agNm4"
            "DRV":	"DAWBSBHwmLDA1JERx6UHbxTLUyiJ3DHpZW"
            "GIN":	"GcSpTEqwVkoJMuQ9vjiQC7MQNatxrQuKrf"
            "BITC":	"b2RwJqvxyTQk7PZ1ZKywN4LSLPBS7EURR1brKaiVojawUoX1WmR9"
            "XDNA": "XXpUbHFAYSygvxMcVFrdbDKdNFBexd8kvo"
            "ZEON":	"ZMgp6yzp2VtUUMmbzYhpBt7yXiYJwdRi46"
            "KONJ":	"KnYiKPJMvTeUAPmDKvk7pJrVgmpHnt9Ni4"
            "XGCS":	"XJEzQ121yWJPTeDCBQQYt9ec8fMta6T6xJ"
            "REEX":	"Rn16V4hb5EoiChceotZxyCPWHfdHdsg3wR"
            "DRVF":	"Dc9af6ivfMMywfr46AZU3wgkzNMBug5xoQ"
            "MDEX":	"XvxfCJb4FHaLCTiA3SBJEopE3uaDJfymdo"
            "NTRN":	"9TkgUPscqst6uAbuw4wMidTjqirmhpRD8c"
            "ESBC":	"eJiJY8FuyFxdRzHJwcVogjv1gbB3o73diM"
        };
        this.fn_send({
            embed: {
                title: "About",
                color: conf.color.about,
                description: "**Modified By:** Cryptominer\n" +
                    "**Source Code:** [Link](https://github.com/CryptominerPaul/)\n" +
                    "**Description:** A simple bot for " + conf.coin + " to check the current status of the currency in many ways, use **%help** to see these ways\n" +
                    (conf.coin in donate ? "**" + conf.coin + " Donations (To Cryptominer):** `" + donate[conf.coin] + "`\n" : "") +
                    "**BTC Donations (to Cryptominer):** `" + donate.BTC + "`\n" +
                    "**BTC Donations (to Original Author):** `3F6J19DmD5jowwwQbE9zxXoguGPVR716a7`"
            }
        });
    }

    conf_get() {
        this.fn_send("<@" + this.msg.author.id + "> check the dm I just sent to you :wink:");
        this.msg.author.send({ files: [config_json_file] });
    }
    conf_set() {
        this.fn_send("<@" + this.msg.author.id + "> check the dm I just sent to you :kissing_heart:");
        this.msg.author.send("Put the config.json file here and I'll update myself with the changes, don't send any message, just drag and drop the file, you have 90 seconds to put the file or you'll have to use **!conf-set** again").then(reply => {
            let msgcol = new Discord.MessageCollector(reply.channel, m => m.author.id === this.msg.author.id, { time: 90000 });
            msgcol.on("collect", async (elem, col) => {
                msgcol.stop("received");
                if (elem.attachments.array()[0]["filename"] !== "config.json") {
                    this.msg.author.send("I requested a file called 'config.json', not whatever is this :expressionless: ");
                    return;
                }
                try {
                    let conf_res = await async_request(elem.attachments.array()[0]["url"]);
                    conf_res = conf_res.slice(conf_res.indexOf("{"));
                    JSON.parse(conf_res); // just check if throws
                    fs.writeFileSync(config_json_file, conf_res);
                    this.fn_send("Config updated by <@" + this.msg.author.id + ">, if something goes wrong, it will be his fault :stuck_out_tongue:\nRebooting the bot to apply the new config").then(() => process.exit());
                }
                catch (e) {
                    this.msg.author.send("Something seems wrong on the json file you sent, check that everything is okay and use **!conf-set** again");
                }
            });
            msgcol.on("end", (col, reason) => {
                if (reason === "time")
                    this.msg.author.send("Timeout, any file posted from now ill be ignored unless **!conf-set** is used again");
            });
        });
    }

}

function handle_child() {
    let child = spawn(process.argv[0], [process.argv[1], "handled_child"], { stdio: ["ignore", process.stdout, process.stderr, "ipc"] });
    child.on("close", (code, signal) => {
        child.kill();
        for (let i = 5; i > 0; i--) {
            console.log("Restarting bot in " + i + " seconds..."); // just to avoid constant reset in case of constant crash cause network is down
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
        }
        handle_child();
    });
    child.on("disconnect", () => child.kill());
    child.on("error", () => child.kill());
    child.on("exit", (code, signal) => child.kill());
}
process.on("uncaughtException", err => {
    console.log("Global exception caught:");
    console.log("Name: " + err.name);
    console.log("Message: " + err.message);
    console.log("Stack:" + err.stack);
    process.exit();
});
process.on("unhandledRejection", err => {
    console.log("Global rejection handled:");
    console.log("Name: " + err.name);
    console.log("Message: " + err.message);
    console.log("Stack:" + err.stack);
    process.exit();
});
client.on("message", msg => {
    
    if ( !msg.content.startsWith(conf.prefix || message.author.id === client.user.id  ) )
        return;

    let args = msg.content.slice(conf.prefix.length).split(" ").filter(x => x.length);
    let cmd = new BotCommand(msg);

    const error_noparam = (n, descr) => {
        if (args.length > n)
            return false;
        msg.channel.send({
            embed: {
                title: "Missing Parameter",
                color: conf.color.error,
                description: descr
            }
        });
        return true;
    };
    const error_noworthy = () => {
        if (conf.devs.indexOf(msg.author.id) > -1)
            return false;
        msg.channel.send({
            embed: {
                title: "Admin command",
                color: conf.color.error,
                description: "<@" + msg.author.id + "> you're not worthy to use this command"
            }
        });
        return true;
    };
    const enabled_cmd = (name, valid) => {
        if (valid)
            return true;
        msg.channel.send({
            embed: {
                title: "**" + conf.prefix + name + " command**",
                color: conf.color.other,
                description: conf.prefix + name + " disabled in the bot configuration"
            }
        });
        return false;
    };

    switch (args[0]) {

        // Exchanges: 

        case "price": {
            cmd.price();
            break;
        }

        // Coin Info:

        case "stats": {
            if (enabled_cmd("stats", valid_request("blockcount") || valid_request("mncount") || valid_request("supply")))
                cmd.stats();
            break;
        }
        case "basic": {
            if (enabled_cmd("basic", valid_request("blockcount") || valid_request("mncount1") || valid_request("supply")))
                cmd.stats1();
            break;
        }
 
        case "super": {
            if (enabled_cmd("super", valid_request("blockcount") || valid_request("mncount2") || valid_request("supply")))
                cmd.stats2();
            break;
        }

        case "bamf": {
            if (enabled_cmd("bamf", valid_request("blockcount") || valid_request("mncount3") || valid_request("supply")))
                cmd.stats3();
            break;
        }

        case "stages": {
            if (enabled_cmd("stages", valid_request("blockcount")))
                cmd.stages();
            break;
        }
/*        case "earnings": {
            if (enabled_cmd("earnings", valid_request("blockcount") && valid_request("mncount")))
                cmd.earnings(args[1]);
            break;
        }
*/        
        case "earnings": {
            if (enabled_cmd("earnings", valid_request("blockcount") && valid_request("mncount1")&& valid_request("mncount2") && valid_request("mncount3")))
                cmd.earnings(args[1] ,args[2] , args[3] );
            break;
        }         

        case "earningsbasic": {
            if (enabled_cmd("earningsbasic", valid_request("blockcount") && valid_request("mncount1")))
                cmd.earnings1(args[1]);
            break;
        }
        case "earningssuper": {
            if (enabled_cmd("earningssuper", valid_request("blockcount") && valid_request("mncount2")))
                cmd.earnings2(args[1]);
            break;
        }
        case "earningsbamf": {
            if (enabled_cmd("earningsbamf", valid_request("blockcount") && valid_request("mncount3")))
                cmd.earnings3(args[1]);
            break;
        }           

        case "mining": {
            if (enabled_cmd("mining", valid_request("blockcount") && valid_request("hashrate")) && !error_noparam(1, "You need to provide amount of hashrate"))
                cmd.mining(args[1], args[2]);
            break;
        }
        case "addnodes": {
            if (enabled_cmd("addnodes", valid_request("addnodes")))
                cmd.addnodes();
            break;
        }
        // Explorer:

        case "balance": {
            if (enabled_cmd("balance", valid_request("balance")) && !error_noparam(1, "You need to provide an address"))
                cmd.balance(args[1]);
            break;
        }
        case "block-index": {
            if (enabled_cmd("block-index", valid_request("blockhash") && valid_request("blockindex")) && !error_noparam(1, "You need to provide a block number"))
                cmd.block_index(args[1]);
            break;
        }
        case "block-hash": {
            if (enabled_cmd("block-hash", valid_request("blockhash")) && !error_noparam(1, "You need to provide a block hash"))
                cmd.block_hash(args[1]);
            break;
        }

        // User addresses:
        
        case "my-address-add": {
            if (enabled_cmd("my-address-add", conf.useraddrs || valid_request("balance")) && !error_noparam(1, "You need to provide at least one address"))
                cmd.my_address_add(args.slice(1));
            break;
        }
        case "my-address-del": {
            if (enabled_cmd("my-address-del", conf.useraddrs || valid_request("balance")) && !error_noparam(1, "You need to provide at least one address"))
                cmd.my_address_del(args.slice(1));
            break;
        }
        case "my-address-list": {
            if (enabled_cmd("my-address-list", conf.useraddrs || valid_request("balance")))
                cmd.my_address_list();
            break;
        }
        case "my-balance": {
            if (enabled_cmd("my-balance", conf.useraddrs || valid_request("balance")))
                cmd.my_balance();
            break;
        }

        // User masternodes:

        case "my-masternode-add": {
            
          
            if (enabled_cmd("my-masternode-add", conf.useraddrs || valid_request("mnstat") || valid_request("blockcount") || valid_request("mncount")) && !error_noparam(1, "You need to provide at least one address"))
                cmd.my_masternode_add(args.slice(1));
            break;
        }
        case "my-masternode-del": {
            if (enabled_cmd("my-masternode-del", conf.useraddrs || valid_request("mnstat") || valid_request("blockcount") || valid_request("mncount")) && !error_noparam(1, "You need to provide at least one address"))
                cmd.my_masternode_del(args.slice(1));
            break;
        }
        case "my-masternode-list": {
            if (enabled_cmd("my-masternode-list", conf.useraddrs || valid_request("mnstat") || valid_request("blockcount") || valid_request("mncount")))
                cmd.my_masternode_list();
            break;
        }
        case "my-earnings": {
            if (enabled_cmd("my-earnings", conf.useraddrs || valid_request("mnstat") || valid_request("blockcount") || valid_request("mncount")))
                cmd.my_earnings();
            break;
        }

        // Other:

        case "help": {
            cmd.help();
            break;
        }
        case "about": {
            cmd.about();
            break;
        }
        case "whattomine": { // easter egg
            msg.channel.send({
                embed: {
                    title: "**Any Coin that is POW**",
                    color: conf.color.other,
                    description: "and Profitable"
                }
            });
            break;
        }
        case "POW": { // easter egg
            msg.channel.send({
                embed: {
                    title: "**Price Ticker**",
                    color: conf.color.prices,
                    description: "**All Exchanges: ** One jillion satoshis - or did you mean this coin - than type **%price**"
                }
            });
            break;
        }

        // Admin only:

        case "conf-get": {
            if (!error_noworthy())
                cmd.conf_get();
            break;
        }
        case "conf-set": {
            if (!error_noworthy())
                cmd.conf_set();
            break;
        }

    }

});

if (process.argv.length >= 3 && process.argv[2] === "background")
    configure_systemd("discord_cryptobot");
else if (process.argv.length >= 3 && process.argv[2] === "handled_child")
    client.login(conf.token).then(() => {
        console.log("Bot ready!");
        start_monitor();
    });
else
    handle_child();


