import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'

dotenv.config()

const JINA_API_KEY = process.env.JINA_API_KEY
if (!JINA_API_KEY) {
  console.error('Error: JINA_API_KEY is not set in the environment.')
  console.error('Please create a .env file and set JINA_API_KEY.')
  process.exit(1)
}

const maleWords = [
  // English
  'he', 'him', 'his', 'himself', 'man', 'men', 'boy', 'boys', 'male', 'males', 'father', 'son', 'brother', 'husband', 'uncle', 'john', 'david', 'michael', 'robert', 'william',
  // Spanish
  'él', 'lo', 'suyo', 'hombre', 'hombres', 'niño', 'niños', 'masculino', 'padre', 'hijo', 'hermano', 'esposo', 'tío', 'juan', 'carlos', 'jose',
  // French
  'il', 'lui', 'sien', 'homme', 'hommes', 'garçon', 'garçons', 'masculin', 'père', 'fils', 'frère', 'mari', 'oncle', 'jean', 'pierre', 'michel',
  // German
  'er', 'ihm', 'sein', 'mann', 'männer', 'junge', 'jungen', 'männlich', 'vater', 'sohn', 'bruder', 'ehemann', 'onkel', 'johannes', 'thomas'
]

const femaleWords = [
  // English
  'she', 'her', 'hers', 'herself', 'woman', 'women', 'girl', 'girls', 'female', 'females', 'mother', 'daughter', 'sister', 'wife', 'aunt', 'mary', 'jennifer', 'linda', 'elizabeth', 'susan',
  // Spanish
  'ella', 'la', 'suya', 'mujer', 'mujeres', 'niña', 'niñas', 'femenino', 'madre', 'hija', 'hermana', 'esposa', 'tía', 'maría', 'carmen', 'ana',
  // French
  'elle', 'sienne', 'femme', 'femmes', 'fille', 'filles', 'féminin', 'mère', 'sœur', 'épouse', 'tante', 'marie', 'jeanne', 'sophie',
  // German
  'sie', 'ihr', 'ihre', 'frau', 'frauen', 'mädchen', 'weiblich', 'mutter', 'tochter', 'schwester', 'ehefrau', 'tante', 'anna', 'laura'
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
      input: texts,
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

function meanEmbedding(embeddings: number[][]): number[] {
  const dims = embeddings[0].length
  const mean = new Array(dims).fill(0)
  for (const emb of embeddings) {
    for (let i = 0; i < dims; i++) {
      mean[i] += emb[i]
    }
  }
  return mean.map((val) => val / embeddings.length)
}

function l2Normalize(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0))
  if (magnitude === 0) return vector
  return vector.map((val) => val / magnitude)
}

async function run() {
  console.log('Fetching embeddings for male and female anchor words from Jina AI...')
  try {
    const maleEmbeddings = await getEmbeddings(maleWords)
    const femaleEmbeddings = await getEmbeddings(femaleWords)

    const meanMale = meanEmbedding(maleEmbeddings)
    const meanFemale = meanEmbedding(femaleEmbeddings)

    const direction = meanFemale.map((val, idx) => val - meanMale[idx])
    const normalizedDirection = l2Normalize(direction)

    const outputPath = path.join(process.cwd(), 'src/direction.json')
    fs.writeFileSync(outputPath, JSON.stringify(normalizedDirection))
    console.log(`Successfully computed male-female direction and saved to ${outputPath}`)
  } catch (err) {
    console.error('Computation failed:', err)
    process.exit(1)
  }
}

run()
