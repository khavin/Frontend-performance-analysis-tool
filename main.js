const fs = require("fs").promises;
const dir = "./trace_data/";
const divider =
  "================================================================================================\n\n";
const dividerWONewLine =
  "================================================================================================\n";

async function getData(fileName) {
  let data = JSON.parse(await fs.readFile(dir + fileName, "utf-8"));
  return data;
}

async function getFileNames(dirName) {
  let data = await fs.readdir(dirName);
  return data;
}

function getInitTS(data) {
  let initTS = -1;

  // Iterate until an object with key 'ts' value > 0 is found
  for (let event of data["traceEvents"]) {
    if ("ts" in event && event["ts"] > 0) {
      initTS = event["ts"];
      break;
    }
  }

  if (initTS === -1) throw new Error("First timestamp not found.");
  return initTS;
}

function getSiteURL(data) {
  for (let event of data["traceEvents"]) {
    if (
      event["name"] === "ResourceSendRequest" &&
      event["args"]["data"]["resourceType"] === "Document"
    ) {
      return event["args"]["data"]["url"];
    }
  }

  return "";
}

function getNameValue(key, first, data) {
  let ts = -1;

  for (let event of data["traceEvents"]) {
    if ("name" in event && event["name"] === key) {
      ts = event["ts"];
      if (first) break;
    }
  }

  if (ts === -1) return -1;
  return ts;
}

// Convert timestamp to time in seconds
function convertTSToTimeInSec(timeStamp) {
  return (timeStamp / 1000000).toFixed(3);
}

// Get critical requests
function getCriticalResources(data, lcpTS) {
  let requests = {};

  for (let event of data["traceEvents"]) {
    // Stop collecting data if the Largest Contentful Paint time is reached
    if (event["ts"] > lcpTS) break;

    if ("name" in event && event["name"] === "ResourceSendRequest") {
      requests[event["args"]["data"]["requestId"]] = {
        start: event["ts"],
        end: null,
        firstReceivedData: null,
        url: event["args"]["data"]["url"],
        fromCache: false,
        priority: event["args"]["data"]["priority"],
        priorityChanged: false,
        renderBlocking: event["args"]["data"]["renderBlocking"],
        timeline: [],
      };
    }

    let currReqId;
    // Get timeline events
    if (
      "args" in event &&
      "data" in event["args"] &&
      "requestId" in event["args"]["data"] &&
      event["args"]["data"]["requestId"] in requests
    ) {
      currReqId = event["args"]["data"]["requestId"];
    }

    if (currReqId && "name" in event) {
      // Push the event name
      requests[currReqId]["timeline"].push(event["name"]);

      if (event["name"] === "ResourceReceiveResponse") {
        requests[currReqId]["fromCache"] = event["args"]["data"]["fromCache"];
      }
      if (event["name"] === "ResourceReceivedData") {
        requests[currReqId]["firstReceivedData"] = event["ts"];
      }
      if (event["name"] === "ResourceFinish") {
        requests[currReqId]["end"] = event["ts"];
      }
      if (event["name"] === "ResourceChangePriority") {
        requests[currReqId]["priorityChanged"] = true;
        requests[currReqId]["priority"] = event["args"]["data"]["priority"];
      }
    }
  }

  for (let rId in requests) {
    if (requests[rId]["firstReceivedData"] === null) {
      delete requests[rId];
    }
  }

  let firstKey = Object.keys(requests)[0];
  let firstEnd = requests[firstKey]["end"];

  // Metrics to calculate
  let lateStartedScripts = [];
  let priorityChangedScripts = [];
  let renderBlockingScripts = [];
  let impScripts = [];
  let cachedCount = 0;
  let maxDuration = 0;
  let maxReqStartTime;
  let longestReq = {};

  for (let rId in requests) {
    if (requests[rId]["fromCache"]) cachedCount++;

    if (requests[rId]["start"] > firstEnd) {
      // Note down the min and max timestamps in the late requests
      // This will be used to calculate the minimum amount of time lost

      if (
        !["Low", "veryLow"].includes(requests[rId]["priority"]) &&
        maxDuration <
          requests[rId]["firstReceivedData"] - requests[rId]["start"]
      ) {
        maxDuration =
          requests[rId]["firstReceivedData"] - requests[rId]["start"];
        maxReqStartTime = requests[rId]["start"];
        longestReq = requests[rId];
      }

      lateStartedScripts.push(requests[rId]);

      if (requests[rId]["priorityChanged"]) {
        priorityChangedScripts.push(requests[rId]);
      }

      if (requests[rId]["renderBlocking"] === "blocking") {
        renderBlockingScripts.push(requests[rId]);
      }

      if (!["Low", "veryLow"].includes(requests[rId]["priority"])) {
        impScripts.push(requests[rId]);
      }
    }
  }

  // console.log(`Total no. of requests: ${Object.keys(requests).length}`);
  // console.log(`Total no. of cached requests: ${cachedCount}`);
  // console.log(
  //   `Total no. of late requests: ${Object.keys(lateStartedScripts).length}`
  // );
  // console.log(
  //   `Total no. of important requests: ${Object.keys(impScripts).length}`
  // );
  // console.log(
  //   `Total no. of priority changed requests: ${
  //     Object.keys(priorityChangedScripts).length
  //   }`
  // );
  // console.log(
  //   `Total no. of render blocking requests: ${
  //     Object.keys(renderBlockingScripts).length
  //   }`
  // );
  // console.log(
  //   `Minimum time lost: ${convertTSToTimeInSec(maxReqStartTime - firstEnd)}s`
  // );
  // console.log(longestReq);
  // console.log("\n");

  return {
    reqs: requests,
    cachedReqC: cachedCount,
    lateReqs: lateStartedScripts,
    impScripts: impScripts,
    priorityChangedScripts: priorityChangedScripts,
    renderBlockingScripts: renderBlockingScripts,
    minTimeLost: convertTSToTimeInSec(maxReqStartTime - firstEnd),
  };
}

function printRequestTimeLine(data, reqId) {
  // Get initial timestamp
  let initTS = getInitTS(data);

  for (let event of data["traceEvents"]) {
    if (
      "args" in event &&
      "data" in event["args"] &&
      "requestId" in event["args"]["data"] &&
      event["args"]["data"]["requestId"] === reqId
    ) {
      let ts = convertTSToTimeInSec(event["ts"] - initTS);
      console.log(`${ts} s: - ${event["name"]}`);
    }
  }
}

async function getMetrics(fileName) {
  try {
    let data = await getData(fileName);

    // Get initial timestamp
    let initTS = getInitTS(data);

    // Get first paint timestamp
    let fpTS = getNameValue("firstPaint", true, data);

    // Get first meaningful paint timestamp
    let fmpTS = getNameValue("firstMeaningfulPaint", false, data);

    // If firstMeaningfulPaint is not present, check for FMP candidate
    if (fmpTS === -1) {
      fmpTS = getNameValue("firstMeaningfulPaintCandidate", false, data);
    }

    // Get largest contentful paint timestamp
    let lcpTS = getNameValue("largestContentfulPaint::Candidate", false, data);

    // Time to first paint
    let fPT = fpTS - initTS;

    // Time to first meaningful paint
    let fMPT = fmpTS - initTS;

    // Time to largest contentful paint
    let lCPT = lcpTS - initTS;

    let criticalMetrics = getCriticalResources(data, lcpTS);

    // printRequestTimeLine(data, "5853.56");

    // Debug for name property

    // Group by different types of trace logs
    // let names = {};

    // data["traceEvents"].forEach((event) => {
    //   if (!(event["name"] in names)) {
    //     names[event["name"]] = 0;
    //   }
    //   names[event["name"]]++;
    // });

    // names = Object.entries(names).sort((a, b) => -(a[1] - b[1]));
    // await fs.writeFile("./names.json", JSON.stringify(names, null, 4));

    // console.log(`Site: ${siteURL}`);
    // console.log(data["metadata"]["networkThrottling"]);
    // console.log("================================================");
    // console.log("First Paint Time: " + convertTSToTimeInSec(fPT) + "s");
    // console.log(
    //   "First Meaningful Paint Time: " + convertTSToTimeInSec(fMPT) + "s"
    // );
    // console.log(
    //   "Largest Contentful Paint Time: " + convertTSToTimeInSec(lCPT) + "s"
    // );
    // console.log("\n");

    criticalMetrics["throttling"] = data["metadata"]["networkThrottling"];
    criticalMetrics["fPT"] = fPT;
    criticalMetrics["fMPT"] = fMPT;
    criticalMetrics["lCPT"] = lCPT;

    return criticalMetrics;
  } catch (e) {
    console.log("Error occured: " + e);
  }
}

function renderText(siteURL, m) {
  let output = `URL tested: ${siteURL}`;

  output += "\n";
  output += `Network throttling: ${m.throttling}\n`;
  output += divider;
  output += "First Paint Time: " + convertTSToTimeInSec(m.fPT) + "s\n";
  output +=
    "First Meaningful Paint Time: " + convertTSToTimeInSec(m.fMPT) + "s\n";
  output +=
    "Largest Contentful Paint Time: " + convertTSToTimeInSec(m.lCPT) + "s\n\n";
  output += divider;
  output += `Total no. of requests: ${Object.keys(m.reqs).length}\n`;
  output += `Total no. of cached requests: ${m.cachedReqC}\n`;
  output += `Total no. of late requests: ${Object.keys(m.lateReqs).length}\n`;
  output += `Total no. of important requests: ${
    Object.keys(m.impScripts).length
  }\n`;
  output += `Total no. of priority changed requests: ${
    Object.keys(m.priorityChangedScripts).length
  }\n`;
  output += `Total no. of render blocking requests: ${
    Object.keys(m.renderBlockingScripts).length
  }\n\n`;

  //output += `Minimum time lost: ${m.minTimeLost}s\n\n`;

  let reqInfo = {
    renderBlockedReqs: {
      data: m.renderBlockingScripts,
      title: "Render blocking requests (Medium/High priority):",
    },
    priorityChangedScripts: {
      data: m.priorityChangedScripts,
      title: "Requests with priority change (Medium/High priority):",
    },
    impScripts: {
      data: m.impScripts,
      title: "All requests with Medium/High priority:",
    },
  };

  for (let req in reqInfo) {
    output += divider;
    output += `${reqInfo[req]["title"]}\n\n`;

    if (reqInfo[req]["data"].length === 0) {
      output += "None\n\n";
      continue;
    }

    // Sort the results based to time to receive first data
    let data = reqInfo[req]["data"];
    data.sort((a, b) => {
      let aDiff = convertTSToTimeInSec(a.firstReceivedData - a.start);
      let bDiff = convertTSToTimeInSec(b.firstReceivedData - b.start);

      return bDiff - aDiff;
    });

    reqInfo[req]["data"].forEach((x, i) => {
      output += `${i + 1})\n`;
      output += "URL: " + x.url + "\n\n";
      output +=
        "Did request complete before Largest Contentful Paint (LCP) event: " +
        (x.end
          ? `true (Total Time: ${convertTSToTimeInSec(x.end - x.start)}s)`
          : "false") +
        "\n";
      output +=
        "Time to receive first data: " +
        convertTSToTimeInSec(x.firstReceivedData - x.start) +
        "s\n\n";
      output += "Priority: " + x.priority + "\n";
      output += "Priority Changed: " + x.priorityChanged + "\n";
      output +=
        "Render Blocking: " + (x.renderBlocking ? "true" : "false") + "\n";
      output += "Loaded from cache: " + x.fromCache + "\n";
      output += "\n\n";
    });
  }

  output += dividerWONewLine + dividerWONewLine;

  return output;
}

async function main() {
  const fileNames = await getFileNames(dir);

  // File name to match
  const fNameRegex = /^Trace.*\.json$/;

  let siteFileMapping = {};

  // Grouping filenames based on site URL
  for (let fName of fileNames) {
    if (fName.match(fNameRegex)) {
      // Get data and Site URL
      let data = await getData(fName);
      let siteURL = getSiteURL(data);

      if (!(siteURL in siteFileMapping)) {
        siteFileMapping[siteURL] = [];
      }

      siteFileMapping[siteURL].push(fName);
    }
  }

  console.log("Created URL-file mappings");
  console.log(siteFileMapping);

  // Process events for each site
  for (let siteURL in siteFileMapping) {
    console.log(`Processing              ${siteURL}`);

    // Sort file name based on timestamp
    siteFileMapping[siteURL].sort();

    let metric1 = await getMetrics(siteFileMapping[siteURL][0]);
    let content = renderText(siteURL, metric1);

    if (siteFileMapping[siteURL].length > 1) {
      let metric2 = await getMetrics(siteFileMapping[siteURL][1]);
      content += "Metrics for second run:\n\n";
      content += dividerWONewLine;
      content += renderText(siteURL, metric2);
    }

    let metricFileName =
      "./output/" + siteURL.replaceAll("/", "_") + "_metric.txt";

    await fs.writeFile(metricFileName, content, { flag: "w" });
    console.log(`Completed processing    ${siteURL}\n`);
    console.log(
      `=========================================================================`
    );
    console.log(`Created: ${metricFileName}`);
    console.log(
      `=========================================================================\n`
    );
  }
}

main();
