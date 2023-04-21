const { chromium, selectors } = require("playwright")
const { format: dateFormat } = require("date-fns")
const fs = require("fs")
const path = require("path")
const csv = require('csv-parser');
require("dotenv").config()

interface PatientData {
  searchName: string;
  date: string;
  dob: string;
  staffName: string;
  staffRole: string;
  symptom: string;
  levyStatus: string;
  quantity: string;
  searchMedication: string;
  firstName: string;
  lastName: string;
  gender: string;
  postcode: string;
  address: string;
  practice: string;
  status?: string;
  time?: number;
}

// Environment Variables
const userLogin: string = process.env.userLogin ?? process.exit(1)
const password: string = process.env.password ?? process.exit(1)
const secret: string = process.env.secret ?? process.exit(1)

// Main Function
async function main() {
  let page = await newPage()
  await login(page, userLogin, password)
  await page.goto(
    "https://pharmoutcomes.org/pharmoutcomes/services/enter?id=122581&xid=122581&xact=provisionnew"
  )
  await handleSecretWord(page, secret)

  const csvData: Array<PatientData> = await readInputFile('inputs/medicine-quantities.csv')

  for (let data of csvData) {
    console.log(`-- Select: Patient has been supplied medicine under the service`)
    await page.getByLabel('Patient has been supplied medicine under the service').click()

    console.log(`-- Levy Status: H - gets Income Support or income related ESA`)
    await page.getByRole("combobox", { name: "Levy Status" }).selectOption('H - gets Income Support or income related ESA') 
    
    console.log(`-- Medication: ${data.searchMedication}`)
    await page.getByLabel("Medication supplied", { exact: true }).click()
    await page.keyboard.down("Control")
    await page.keyboard.press("A")
    await page.keyboard.up("Control")
    await page.keyboard.type(data.searchMedication, { delay: 10 })
    
    console.log(`-- Waiting for medication popup...`)
    await page.locator("selector=#ui-id-2").first().click({ timeout: 10000, trial: true })

    try {
      console.log(`-- Selecting Medication...`)
      await page.locator("selector=#ui-id-2 li a").first().click({ timeout: 3000 })
      console.log(`-- Medication Selected!`)
    } catch (e) {
      console.log(e)
      
    }
    
    console.log(`-- Quantity: ${data.quantity}`)
    await page.getByRole("textbox", { name: "Quantity" }).click()
    await page.keyboard.down("Control")
    await page.keyboard.press("A")
    await page.keyboard.up("Control")
    await page.keyboard.type(data.quantity, { delay: 10 })
    await page.keyboard.press('Tab')

    await page.pause()
  }

  await page.pause()
}

async function registerSelectorLocator() {
  // Must be a function that evaluates to a selector engine instance.
  const createSelectorNameEngine = () => ({
    // Returns the first element matching given selector in the root's subtree.
    query(root, selector) {
      return root.querySelector(selector)
    },

    // Returns all elements matching given selector in the root's subtree.
    queryAll(root, selector) {
      return Array.from(root.querySelectorAll(selector))
    },
  })

  // Register the engine. Selectors will be prefixed with "tag=".
  await selectors.register("selector", createSelectorNameEngine)
}

async function newPage() {
  await registerSelectorLocator()
  const browser = await chromium.launch({ headless: false, slowMo: 100 })
  return browser.newPage()
}

async function login(page, userLogin, password) {
  await page.goto("https://pharmoutcomes.org/pharmoutcomes/")
  await page
    .locator("selector=#login-form-elements input[name=login_name]")
    .fill(userLogin)
  await page
    .locator("selector=#login-form-elements input[name=login_pwd]")
    .fill(password)
  await page.locator("selector=#login-form-elements input[type=submit]").click()
  await page
    .getByRole("link", { name: "Stone Pharmacy (Meds2u Limited)" })
    .click()
}

async function handleSecretWord(page, secret: string) {
  if (!page.url().includes("passcode?enter")) {
    return
  }
  const firstSecretLetter = await page
    .locator("selector=form input[type=password]")
    .nth(0)
  const secondSecretLetter = await page
    .locator("selector=form input[type=password]")
    .nth(1)
  await firstSecretLetter.fill(await secretLetter(firstSecretLetter, secret))
  await secondSecretLetter.fill(await secretLetter(secondSecretLetter, secret))
  await page.getByRole("button", { name: "Submit" }).click()
}

async function secretLetter(secretLetterEl, secret: string): Promise<string> {
  const name = await secretLetterEl.getAttribute("name")
  const letterPosition: number = name.match(/[\w]+(\d)$/)[1]
  const letter = secret[letterPosition - 1]
  return letter
}

async function readInputFile(filepath) {
  const csvData: any[] = await new Promise((resolve, reject) => {
    const data: any[] = []
    fs.createReadStream(filepath)
      .pipe(csv())
      .on("data", (row) => {
        // Create an object for each row of data
        const obj = {}
        for (const key in row) {
          // Use the column names as keys and the row values as values
          obj[key] = row[key]
        }
        // Add the object to the data array
        data.push(obj)
      })
      .on("end", () => {
        // Resolve the Promise with the fully populated data array
        resolve(data)
      })
      .on("error", (error) => {
        // Reject the Promise with the error
        reject(error)
      })
  })

  return csvData
}

main()
