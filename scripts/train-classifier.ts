import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { normalizeName } from '../src/name'

dotenv.config()

const JINA_API_KEY = process.env.JINA_API_KEY
if (!JINA_API_KEY) {
  console.error('Error: JINA_API_KEY is not set in the environment.')
  process.exit(1)
}

const femaleExamples = [
  'she', 'her', 'hers', 'herself', 'woman', 'women', 'girl', 'girls', 'female', 'females', 'mother', 'daughter', 'sister', 'wife', 'aunt',
  'ella', 'la', 'suya', 'mujer', 'mujeres', 'niña', 'niñas', 'femenino', 'madre', 'hija', 'hermana', 'esposa', 'tía',
  'elle', 'sienne', 'femme', 'femmes', 'fille', 'filles', 'féminin', 'mère', 'sœur', 'épouse', 'tante',
  'sie', 'ihr', 'ihre', 'frau', 'frauen', 'mädchen', 'weiblich', 'mutter', 'tochter', 'schwester', 'ehefrau', 'tante',
  'mary', 'jennifer', 'linda', 'elizabeth', 'susan', 'olivia', 'jessica', 'tina', 'deborah', 'emma', 'sarah', 'emily', 'abigail', 'madison', 'chloe', 'mia', 'isabella',
  'maría', 'carmen', 'ana', 'sofia', 'camila', 'valeria', 'mariana', 'lucia', 'daniela',
  'marie', 'jeanne', 'sophie', 'lea', 'manon', 'camille',
  'anna', 'laura', 'hannah', 'sophia', 'leonie', 'sabine', 'susanne', 'petra', 'birgit', 'andrea', 'monika', 'martina', 'stefanie', 'katrin', 'anja', 'ursula', 'karin', 'heike', 'claudia', 'nicole', 'jutta', 'renate', 'ulrike', 'barbara', 'sylvia',
  'dorota', 'katarzyna', 'magdalena', 'agnieszka', 'rina',
  'Olivia Sullivan', 'Jessica Zellers', 'Tina Smith', 'Deborah McDowell', 'Julia Sena', 'Alina Hagen', 'Tuuli Huhtilainen', 'Mari', 'Cally Beaton', 'Jaana',
  'Emma', 'Mia', 'Hannah', 'Emilia', 'Sofia', 'Lina', 'Anna', 'Mila', 'Lea', 'Marie', 'Lena', 'Leonie', 'Amelie', 'Sophie', 'Johanna', 'Luisa', 'Clara', 'Charlotte', 'Mathilda', 'Nele', 'Leni', 'Sarah', 'Julia', 'Laura', 'Lisa', 'Katharina', 'Christina', 'Nadine', 'Melanie', 'Kerstin', 'Marion', 'Ute', 'Angelika', 'Brigitte', 'Alice', 'Eve', 'Grace', 'Chloe', 'Zoe', 'Lily'
]

const maleExamples = [
  'he', 'him', 'his', 'himself', 'man', 'men', 'boy', 'boys', 'male', 'males', 'father', 'son', 'brother', 'husband', 'uncle',
  'él', 'lo', 'suyo', 'hombre', 'hombres', 'niño', 'niños', 'masculino', 'padre', 'hijo', 'hermano', 'esposo', 'tío',
  'il', 'lui', 'sien', 'homme', 'hommes', 'garçon', 'garçons', 'masculin', 'père', 'fils', 'frère', 'mari', 'oncle',
  'er', 'ihm', 'sein', 'mann', 'männer', 'junge', 'jungen', 'männlich', 'vater', 'sohn', 'bruder', 'ehemann', 'onkel',
  'john', 'david', 'michael', 'robert', 'william', 'james', 'oliver', 'benjamin', 'elijah', 'lucas', 'mason', 'logan', 'alexander', 'ethan', 'jacob',
  'juan', 'carlos', 'jose', 'mateo', 'santiago', 'matias', 'sebastian', 'nicolas', 'samuel', 'diego',
  'jean', 'pierre', 'michel', 'hugo', 'jules', 'enzo', 'arthur', 'nathan', 'mathis',
  'johannes', 'thomas', 'maximilian', 'paul', 'elias', 'ben', 'jonas', 'noah', 'stefan', 'andreas', 'frank', 'christian', 'jürgen', 'klaus', 'peter', 'dieter', 'uwe', 'matthias', 'bernd', 'heinz', 'werner', 'gerhard', 'martin', 'jörg', 'manfred',
  'matej', 'marek', 'jan', 'piotr', 'tomasz',
  'Sean Marshall', 'Jim Musil Painter', 'Chris H.', 'Mikael A. Manninen', 'Dziadek Marek', 'Malcolm D.', 'David Bollero', 'João João',
  'Florian', 'Max', 'Class', 'Claas', 'Klaas',
  'Lukas', 'Leon', 'Finn', 'Luis', 'Luca', 'Felix', 'Henry', 'Emil', 'Oskar', 'Anton', 'Philipp', 'Julian', 'Tom', 'Moritz', 'Julius', 'Jan', 'Tim', 'Timo', 'Tobias', 'Jens', 'Günter', 'Helmut', 'Karl', 'Hans', 'Rolf', 'Wolfgang', 'Arthur', 'Leo', 'Bruno', 'Emilian', 'Mats', 'Liam', 'Adam', 'Jack', 'Harry', 'Jacob', 'Charlie', 'George', 'Oscar', 'James', 'William'
]

const neutralExamples = [
  'NBC News', 'Forbes', 'The Verge', 'Mother Jones', 'Guardian US', 'ProPublica', 'Cheddar', 'The Washington Post', 'DIE ZEIT',
  'Skittles', 'Blue Wave', 'Digital Brain', 'Cats of Yore', 'Bichinhos Fofinhos', 'WeRateDogs', 'Climb To The Clouds',
  'gatos fazendo gatices', 'FLAVOR FLAV', 'Never Trump', 'Bananenflanke', 'Laserbrille',
  'news', 'sports', 'weather', 'music', 'art', 'photography', 'tech', 'science', 'politics'
]

async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const res = await (globalThis as any).fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${JINA_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'jina-embeddings-v5-text-small',
      // Normalize the same way the feed handler does, so training and inference
      // embed identically shaped strings.
      input: texts.map(normalizeName),
      task: 'classification',
    }),
  })
  if (!res.ok) {
    const errorText = await res.text()
    throw new Error(`Jina API error: ${res.status} ${errorText}`)
  }
  const json: any = await res.json()
  return json.data.map((item: any) => item.embedding)
}

function l2Normalize(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0))
  if (magnitude === 0) return vector
  return vector.map((val) => val / magnitude)
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z))
}

function trainLogisticRegression(X: number[][], y: number[], epochs: number = 2000, lr: number = 0.1) {
  const numFeatures = X[0].length
  const w = new Array(numFeatures).fill(0)
  let b = 0

  for (let e = 0; e < epochs; e++) {
    for (let i = 0; i < X.length; i++) {
      let z = b
      for (let j = 0; j < numFeatures; j++) {
        z += w[j] * X[i][j]
      }
      const pred = sigmoid(z)
      const error = pred - y[i]
      
      b -= lr * error
      for (let j = 0; j < numFeatures; j++) {
        w[j] -= lr * error * X[i][j]
      }
    }
  }
  return { w, b }
}

async function run() {
  console.log('Fetching embeddings for female, male, and neutral examples from Jina AI...')
  try {
    const femaleEmbs = await getEmbeddings(femaleExamples)
    const maleEmbs = await getEmbeddings(maleExamples)
    const neutralEmbs = await getEmbeddings(neutralExamples)

    const X: number[][] = []
    const y: number[] = []

    // Add female examples (y = 1)
    for (const emb of femaleEmbs) {
      X.push(l2Normalize(emb))
      y.push(1)
    }

    // Add male examples (y = 0)
    for (const emb of maleEmbs) {
      X.push(l2Normalize(emb))
      y.push(0)
    }

    // Add neutral examples (y = 0)
    for (const emb of neutralEmbs) {
      X.push(l2Normalize(emb))
      y.push(0)
    }

    console.log(`Training Logistic Regression classifier on ${X.length} examples...`)
    const { w, b } = trainLogisticRegression(X, y, 2000, 0.1)

    const outputPath = path.join(process.cwd(), 'src/classifier.json')
    fs.writeFileSync(outputPath, JSON.stringify({ w, b }))
    console.log(`Successfully trained classifier and saved to ${outputPath}`)
  } catch (err) {
    console.error('Computation failed:', err)
    process.exit(1)
  }
}

run()
