const expect = require('chai').expect
const utils = require('../../utils/test_utils')
const bsv = require('bsv')
require('dotenv').config()

const {
  contract,
  issue,
  transfer,
  split,
  merge,
  mergeSplit,
  redeem
} = require('../../../index')

const {
  bitcoinToSatoshis,
  getTransaction,
  getFundsFromFaucet,
  broadcast
} = require('../../../index').utils

describe('regression, testnet', () => {
  // Life Cycle Test with different supply
  it('Full Life Cycle Test With More Supply', async () => {
    const issuerPrivateKey = bsv.PrivateKey()
    const fundingPrivateKey = bsv.PrivateKey()
    const alicePrivateKey = bsv.PrivateKey()
    const aliceAddr = alicePrivateKey.toAddress(process.env.NETWORK).toString()
    const bobPrivateKey = bsv.PrivateKey()
    const bobAddr = bobPrivateKey.toAddress(process.env.NETWORK).toString()
    const contractUtxos = await getFundsFromFaucet(issuerPrivateKey.toAddress(process.env.NETWORK).toString())
    const fundingUtxos = await getFundsFromFaucet(fundingPrivateKey.toAddress(process.env.NETWORK).toString())
    const publicKeyHash = bsv.crypto.Hash.sha256ripemd160(issuerPrivateKey.publicKey.toBuffer()).toString('hex')
    const supply = 500000
    const symbol = 'TAALT'
    const wait = 5000

    const schema = utils.schema(publicKeyHash, symbol, supply)

    // change goes back to the fundingPrivateKey
    const contractHex = await contract(
      issuerPrivateKey,
      contractUtxos,
      fundingUtxos,
      fundingPrivateKey,
      schema,
      supply
    )
    const contractTxid = await broadcast(contractHex)
    console.log(`Contract TX:     ${contractTxid}`)
    const contractTx = await getTransaction(contractTxid)
    const amount = await utils.getVoutAmount(contractTxid, 0)
    expect(amount).to.equal(supply / 100000000)

    let issueHex
    try {
      issueHex = await issue(
        issuerPrivateKey,
        utils.getIssueInfo(aliceAddr, 400000, bobAddr, 100000),
        utils.getUtxo(contractTxid, contractTx, 0),
        utils.getUtxo(contractTxid, contractTx, 1),
        fundingPrivateKey,
        true,
        symbol,
        2
      )
    } catch (e) {
      console.log('error issuing token', e)
      return
    }
    const issueTxid = await broadcast(issueHex)
    await new Promise(resolve => setTimeout(resolve, wait))
    console.log(`Issue TX:        ${issueTxid}`)
    const issueTx = await getTransaction(issueTxid)
    const tokenId = await utils.getToken(issueTxid)
    const response = await utils.getTokenResponse(tokenId)
    expect(response.symbol).to.equal(symbol)
    expect(await utils.getVoutAmount(issueTxid, 0)).to.equal(0.004)
    expect(await utils.getVoutAmount(issueTxid, 1)).to.equal(0.001)
    await utils.isTokenBalance(aliceAddr, 400000)
    await utils.isTokenBalance(bobAddr, 100000)

    const issueOutFundingVout = issueTx.vout.length - 1

    const transferHex = await transfer(
      bobPrivateKey,
      utils.getUtxo(issueTxid, issueTx, 1),
      aliceAddr,
      utils.getUtxo(issueTxid, issueTx, issueOutFundingVout),
      fundingPrivateKey
    )
    const transferTxid = await broadcast(transferHex)
    console.log(`Transfer TX:     ${transferTxid}`)
    const transferTx = await getTransaction(transferTxid)
    expect(await utils.getVoutAmount(transferTxid, 0)).to.equal(0.001)
    await utils.isTokenBalance(aliceAddr, 500000)
    await utils.isTokenBalance(bobAddr, 0)

    // Split tokens into 2 - both payable to Bob...
    const bobAmount1 = transferTx.vout[0].value / 2
    const bobAmount2 = transferTx.vout[0].value - bobAmount1
    const splitDestinations = []
    splitDestinations[0] = { address: bobAddr, satoshis: bitcoinToSatoshis(bobAmount1) }
    splitDestinations[1] = { address: bobAddr, satoshis: bitcoinToSatoshis(bobAmount2) }

    const splitHex = await split(
      alicePrivateKey,
      utils.getUtxo(transferTxid, transferTx, 0),
      splitDestinations,
      utils.getUtxo(transferTxid, transferTx, 1),
      fundingPrivateKey
    )
    const splitTxid = await broadcast(splitHex)
    await new Promise(resolve => setTimeout(resolve, wait))
    console.log(`Split TX:        ${splitTxid}`)
    const splitTx = await getTransaction(splitTxid)
    expect(await utils.getVoutAmount(splitTxid, 0)).to.equal(0.0005)
    expect(await utils.getVoutAmount(splitTxid, 1)).to.equal(0.0005)
    await utils.isTokenBalance(aliceAddr, 400000)
    await utils.isTokenBalance(bobAddr, 100000)

    // Now let's merge the last split back together
    const splitTxObj = new bsv.Transaction(splitHex)

    const mergeHex = await merge(
      bobPrivateKey,
      utils.getMergeUtxo(splitTxObj),
      aliceAddr,
      utils.getUtxo(splitTxid, splitTx, 2),
      fundingPrivateKey
    )

    const mergeTxid = await broadcast(mergeHex)
    console.log(`Merge TX:        ${mergeTxid}`)
    const mergeTx = await getTransaction(mergeTxid)
    expect(await utils.getVoutAmount(mergeTxid, 0)).to.equal(0.001)
    const tokenIdMerge = await utils.getToken(issueTxid)
    const responseMerge = await utils.getTokenResponse(tokenIdMerge)
    expect(responseMerge.symbol).to.equal(symbol)
    await utils.isTokenBalance(aliceAddr, 500000)
    await utils.isTokenBalance(bobAddr, 0)

    const amount2 = bitcoinToSatoshis(mergeTx.vout[0].value / 2)

    const split2Destinations = []
    split2Destinations[0] = { address: bobAddr, satoshis: amount2 }
    split2Destinations[1] = { address: bobAddr, satoshis: amount2 }

    const splitHex2 = await split(
      alicePrivateKey,
      utils.getUtxo(mergeTxid, mergeTx, 0),
      split2Destinations,
      utils.getUtxo(mergeTxid, mergeTx, 1),
      fundingPrivateKey
    )
    const splitTxid2 = await broadcast(splitHex2)
    console.log(`Split TX2:       ${splitTxid2}`)
    const splitTx2 = await getTransaction(splitTxid2)
    expect(await utils.getVoutAmount(splitTxid2, 0)).to.equal(0.0005)
    expect(await utils.getVoutAmount(splitTxid2, 1)).to.equal(0.0005)
    await utils.isTokenBalance(aliceAddr, 400000)
    await utils.isTokenBalance(bobAddr, 100000)

    // Now mergeSplit
    const splitTxObj2 = new bsv.Transaction(splitHex2)

    const aliceAmountSatoshis = bitcoinToSatoshis(splitTx2.vout[0].value) / 2
    const bobAmountSatoshis = bitcoinToSatoshis(splitTx2.vout[0].value) + bitcoinToSatoshis(splitTx2.vout[1].value) - aliceAmountSatoshis

    const mergeSplitHex = await mergeSplit(
      bobPrivateKey,
      utils.getMergeSplitUtxo(splitTxObj2, splitTx2),
      aliceAddr,
      aliceAmountSatoshis,
      bobAddr,
      bobAmountSatoshis,
      utils.getUtxo(splitTxid2, splitTx2, 2),
      fundingPrivateKey
    )

    const mergeSplitTxid = await broadcast(mergeSplitHex)
    console.log(`MergeSplit TX:   ${mergeSplitTxid}`)
    const mergeSplitTx = await getTransaction(mergeSplitTxid)
    expect(await utils.getVoutAmount(mergeSplitTxid, 0)).to.equal(0.00025)
    expect(await utils.getVoutAmount(mergeSplitTxid, 1)).to.equal(0.00075)
    await utils.isTokenBalance(aliceAddr, 425000)
    await utils.isTokenBalance(bobAddr, 75000)

    // Alice wants to redeem the money from bob...
    const redeemHex = await redeem(
      alicePrivateKey,
      issuerPrivateKey.publicKey,
      utils.getUtxo(mergeSplitTxid, mergeSplitTx, 0),
      utils.getUtxo(mergeSplitTxid, mergeSplitTx, 2),
      fundingPrivateKey
    )
    const redeemTxid = await broadcast(redeemHex)
    console.log(`Redeem TX:       ${redeemTxid}`)
    expect(await utils.getVoutAmount(redeemTxid, 0)).to.equal(0.00025)
    await utils.isTokenBalance(aliceAddr, 400000)
    await utils.isTokenBalance(bobAddr, 75000)
  })
})
