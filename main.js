const fs = require("fs").promises;

async function getData(fileName) {
  let data = JSON.parse(await fs.readFile("./trace_data/" + fileName, "utf-8"));
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

function getNameValue(key, first, data) {
  let ts = -1;

  for (let event of data["traceEvents"]) {
    if ("name" in event && event["name"] === key) {
      ts = event["ts"];
      if (first) break;
    }
  }

  if (ts === -1) throw new Error(key + " timestamp not found.");
  return ts;
}

// Convert timestamp to time in seconds
function convertTSToTimeInSec(timeStamp) {
  return timeStamp / 1000000;
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
        url: event["args"]["data"]["url"],
        fromCache: false,
      };
    }
    if ("name" in event && event["name"] === "ResourceReceiveResponse") {
      requests[event["args"]["data"]["requestId"]]["fromCache"] =
        event["args"]["data"]["fromCache"];
    }
    if (
      "name" in event &&
      event["name"] === "ResourceFinish" &&
      event["args"]["data"]["requestId"] in requests
    ) {
      requests[event["args"]["data"]["requestId"]]["end"] = event["ts"];
    }
  }

  for (let rId in requests) {
    if (requests[rId]["end"] === null) {
      delete requests[rId];
    }
  }
  console.log(requests);
  let firstKey = Object.keys(requests)[0];
  let firstEnd = requests[firstKey]["end"];

  console.log(firstEnd);
  for (let rId in requests) {
    if (requests[rId]["start"] <= firstEnd) {
      console.log(requests[rId]["url"]);
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

    // Get largest contentful paint timestamp
    let lcpTS = getNameValue("largestContentfulPaint::Candidate", false, data);

    // Time to first paint
    let fPT = fpTS - initTS;

    // Time to first meaningful paint
    let fMPT = fmpTS - initTS;

    // Time to largest contentful paint
    let lCPT = lcpTS - initTS;

    //getCriticalResources(data, lcpTS);
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

    console.log(data["metadata"]["networkThrottling"]);
    console.log("================================================");
    console.log("First Paint Time: " + convertTSToTimeInSec(fPT) + "s");
    console.log(
      "First Meaningful Paint Time: " + convertTSToTimeInSec(fMPT) + "s"
    );
    console.log(
      "Largest Contentful Paint Time: " + convertTSToTimeInSec(lCPT) + "s"
    );
    console.log("\n");
  } catch (e) {
    console.log("Error occured: " + e);
  }
}

async function main() {
  await getMetrics("test.json");
  await getMetrics("test1.json");
}

main();
