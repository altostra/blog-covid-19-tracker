const Axios = require('axios')
const AWS = require('aws-sdk')
const docClient = new AWS.DynamoDB.DocumentClient()
const sns = new AWS.SNS({ apiVersion: '2010-03-31' })

const {
  API_URL,
  COUNTRY,
  NOTIFY_WHEN_OVER,
  TOPIC_NOTIFICATIONS01,
  TABLE_COVIDDATA01,
} = process.env

if (!API_URL || !COUNTRY || !NOTIFY_WHEN_OVER || !TOPIC_NOTIFICATIONS01 || !TABLE_COVIDDATA01) {
  throw new Error(`Missing one of the expected environment variables.`)
}

exports.handler = async () => {
  console.log(`Starting with parameters: ${API_URL}, ${COUNTRY}, ${NOTIFY_WHEN_OVER}.`)

  try {
    const response = await Axios.get(API_URL)

    if (response.status !== 200) {
      console.error(`Operation failed, the COVID-19 API returned an error: ${response.statusText}.`)
      return
    }

    const data = response.data
    if (!Array.isArray(data)) {
      console.error(`Response data is not an array as expected: ${typeof data}.`)
      return
    }

    const country = data.find(x => x && x.country === COUNTRY)
    if (!country) {
      console.warn(`Response doesn't contain the requested country: ${COUNTRY}.`)
      return
    }

    const infected = country.infected
    if (typeof infected !== 'number') {
      console.warn(`The infected data for '${COUNTRY}' is not a number: ${infected}.`)
      return
    }

    const previouslyInfected = await getPreviouslyInfected()
    const infectionDifference = infected - previouslyInfected
    if (infectionDifference > NOTIFY_WHEN_OVER) {
      console.info(`The infection difference [${infectionDifference}] is higher than the limit: ${NOTIFY_WHEN_OVER}.`)
      console.info(`Notifying subscribers.`)
      await notifySubscribers(infectionDifference)
    } else {
      console.info(`The infection difference [${infectionDifference}] is lower than the limit: ${NOTIFY_WHEN_OVER}.`)
    }

    await updatePreviouslyInfected(infected)
    console.info(`Updated last infection value to ${infected}.`)
  } catch (err) {
    console.error(`Operation failed.`, err)
  }
}

async function updatePreviouslyInfected(infections) {
  const params = {
    TableName: TABLE_COVIDDATA01,
    Item: {
      'pk': 'previouslyInfected',
      infections,
    }
  }

  try {
    await docClient.put(params).promise()
  } catch (err) {
    console.error(`Unable to update table data:`, err)
    throw new Error(`Failed to store infections data.`)
  }
}

async function getPreviouslyInfected() {
  const params = {
    TableName: TABLE_COVIDDATA01,
    Key: {
      'pk': 'previouslyInfected'
    }
  }

  try {
    const data = await docClient.get(params).promise()
    return data && data.Item && data.Item.infections || 0
  } catch (err) {
    console.error(`Unable to get table data:`, err)
    throw new Error(`Failed to load infections data.`)
  }
}

async function notifySubscribers(infections) {
  const params = {
    Message: `WARNING! The infections difference has crossed the set limit of ${NOTIFY_WHEN_OVER}, it is now at ${infections}.`,
    TopicArn: TOPIC_NOTIFICATIONS01
  }

  try {
    await sns.publish(params).promise()
  } catch (err) {
    console.error(`Failed to publish message to the SNS topic.`, err)
    throw new Error(`Failed to notify subscribers.`)
  }
}
