import { ActionType, createOfferForPair, getInputPrice, getLiquidityQuote, getOutputPrice, getPairByLauncherId, getQuoteForPair } from '@/api';
import GobyWallet from '@/utils/walletIntegration/wallets/gobyWallet';
import type { OfferResponse, Pair, Quote, Token } from '@/api';
import type { GenerateOfferData } from './TabContainer';
import { useEffect, useState, useContext } from 'react';
import WalletContext from '@/context/WalletContext';
import SuccessScreen from './SuccessScreen';
import Image from 'next/image';

type GenerateOfferProps = {
  data: GenerateOfferData;
  setOrderRefreshActive: (value: boolean) => void;
  devFee: number;
  dataRefreshPercent: number;
  setGenerateOfferData: (value: GenerateOfferData) => void;
  setDataRefreshPercent: (value: number) => void;
  activeTab: 'swap' | 'liquidity';
};

const GenerateOffer: React.FC<GenerateOfferProps> = ({ data, setOrderRefreshActive, devFee, setGenerateOfferData, setDataRefreshPercent, activeTab }) => {
    const [step, setStep] = useState<number>(0);
    /*
        steps:
            - 0: loading (check data)
            - 1: verified; ask user to confirm
            - 2: summary & paste
            - 3: send to server & see response
        errors:
            - -1 - amounts don't match
    */
    const [pairAndQuote, setPairAndQuote] = useState<[Pair, Quote] | null>(null);
    const [offer, setOffer] = useState<string>('');
    const [offerResponse, setOfferResponse] = useState<OfferResponse | null>(null);
    const [pair, setPair] = useState<Pair | null>(null);

    // Update pair rates every 4 seconds
    useEffect(() => {

        const updateOrderData = setInterval(async () => {

            const updatePair = async () => {
                console.log('Updating Pair')
                const newPairData = await getPairByLauncherId(data.pairId);
                setPair(newPairData)
            }
            updatePair()


            // Update order rates every 4 seconds
            const updateOfferDataSwap = () => {
                if (pair) {
                    const newOfferData = {...data};
                    const isBuy = newOfferData.offer[0][0].short_name === process.env.NEXT_PUBLIC_XCH;
                    const { xch_reserve, token_reserve } = pair // Get latest reserve amounts
                    
                    if (isBuy) {
                        const amount0 = newOfferData.offer[0][2]
                        const amount1 = getInputPrice(amount0, xch_reserve, token_reserve); // Get updated token quote
                        newOfferData.request[0][2] = amount1;
                        setGenerateOfferData(newOfferData);
                        console.log("Updating offer data");
                    } else {
                      const amount1 = newOfferData.offer[0][2];
                      const amount0 = getInputPrice(amount1, token_reserve, xch_reserve); // Get updated XCH quote
                      newOfferData.request[0][2] = amount0;
                      console.log("Updating offer data");
                      setGenerateOfferData(newOfferData);
                    }
                }
                setDataRefreshPercent(0)
            }
            if (activeTab === 'swap') updateOfferDataSwap()


            const updateOfferDataLiquidity = () => {
                if (pair) {
                    const newOfferData = {...data};
                    const isAddLiquidity = newOfferData.action === "ADD_LIQUIDITY";
                    const { xch_reserve, token_reserve, liquidity } = pair; // Get latest reserve amounts
                    const pairLiquidity = liquidity;
                    
                    
                    if (isAddLiquidity) {
                      const tokenAmount = newOfferData.offer[1][2];
                      const liquidity = getLiquidityQuote(tokenAmount, token_reserve, pairLiquidity, false);
                      var xchAmount = getLiquidityQuote(tokenAmount, token_reserve, xch_reserve, false);
                      xchAmount += liquidity;
    
                      newOfferData.offer[0][2] = xchAmount; // Update Amount0
                      newOfferData.request[0][2] = liquidity; // Update Amount2
    
                      console.log("Updating offer data");
                      setGenerateOfferData(newOfferData);
                    } else {
                      const liquidityTokens = newOfferData.offer[0][2]
                      const tokenAmount = getLiquidityQuote(liquidityTokens, pairLiquidity, token_reserve, true);
                      var xchAmount = getLiquidityQuote(liquidityTokens, liquidity, xch_reserve, true);
                      xchAmount += liquidity;
                    
                      newOfferData.request[0][2] = xchAmount; // Update Amount0
                      newOfferData.request[1][2] = tokenAmount; // Update Amount1
    
                      console.log("Updating offer data");
                      setGenerateOfferData(newOfferData);
                    }
                }
                setDataRefreshPercent(0)
            }
            if (activeTab === 'liquidity') updateOfferDataLiquidity()


            // Update fee
            const updateFee = async () => {
                if (!pair) return;
                console.log('Updating Fee')
                const quote = await getQuoteForPair(
                    data.pairId,
                    data.offer[0][2],
                    undefined,
                    data.offer[0][1],
                    true
                );
                setPairAndQuote([pair, quote]);
            }
            updateFee()

        }, 4000)
        return () => clearInterval(updateOrderData)
    }, [data, pair, setDataRefreshPercent, setGenerateOfferData, activeTab])

    
    
    useEffect(() => {
        async function namelessFunction() {
            if(step === 0 && pairAndQuote === null) {
                const pair = await getPairByLauncherId(data.pairId);
                const quote = await getQuoteForPair(
                    data.pairId,
                    data.offer[0][2],
                    undefined,
                    data.offer[0][1],
                    true
                );
                setPairAndQuote([pair, quote]);
            } else if(step === 0) {
                setOrderRefreshActive(true)
                const numAssets = data.offer.length + data.request.length;
                if(numAssets === 2) {
                    const token0IsXCH = data.offer[0][1];
                    const token0Amount = data.offer[0][2];
                    const token1Amount = data.request[0][2];

                    var xchAmount: number = token0Amount,
                        tokenAmount: number = token1Amount;
                    if(!token0IsXCH) {
                        xchAmount = token1Amount;
                        tokenAmount = token0Amount;
                    }
                    
                    const pair = pairAndQuote![0];
                    if(token0IsXCH) {
                        const expectedTokenAmount = getInputPrice(xchAmount, pair.xch_reserve, pair.token_reserve);
                        if(expectedTokenAmount > tokenAmount) {
                            setStep(-1);
                            setOrderRefreshActive(false);
                        } else {
                            const expectedXCHAmount = getOutputPrice(tokenAmount, pair.xch_reserve, pair.token_reserve)
                            if(expectedXCHAmount < xchAmount) {
                                const newOfferData = {...data};
                                newOfferData.offer[0][2] = expectedXCHAmount;
                                console.log("Updating offer data");
                                setGenerateOfferData(newOfferData);
                            }
                            setStep(2);
                        }
                    }
                    
                    if(!token0IsXCH) {
                        const expectedXCHAmount = getInputPrice(tokenAmount, pair.token_reserve, pair.xch_reserve);
                        if(expectedXCHAmount < xchAmount) {
                            setStep(-1);
                            setOrderRefreshActive(false);
                        } else {
                            if(expectedXCHAmount > xchAmount) {
                                const newOfferData = {...data};
                                newOfferData.request[0][2] = expectedXCHAmount;
                                console.log("Updating offer data");
                                setGenerateOfferData(newOfferData);
                            }
                            setStep(2);
                        }
                    }
                } else {
                    const takeAssetsFromOffer = data.offer.length === 2;

                    var token0Amount: number,
                        token0IsXCH: boolean,
                        token1Amount: number,
                        liquidityAmount: number;

                    if(takeAssetsFromOffer) {
                        token0Amount = data.offer[0][2];
                        token0IsXCH = data.offer[0][1];
                        token1Amount = data.offer[1][2];
                        liquidityAmount = data.request[0][2];
                    } else {
                        token0Amount = data.request[0][2];
                        token0IsXCH = data.request[0][1];
                        token1Amount = data.request[1][2];
                        liquidityAmount = data.offer[0][2];
                    }

                    var xchAmount: number = token0Amount,
                        tokenAmount: number = token1Amount;
                    if(!token0IsXCH) {
                        xchAmount = token1Amount;
                        tokenAmount = token0Amount;
                    }
                    
                    const pair = pairAndQuote![0];
                    var expectedTokenAmount = tokenAmount;
                    var expectedXCHAmount = getLiquidityQuote(tokenAmount, pair.token_reserve, pair.xch_reserve, false);
                    var expectedLiquidityAmount = getLiquidityQuote(tokenAmount, pair.token_reserve, pair.liquidity, false);

                    if(data.action === ActionType.ADD_LIQUIDITY) {
                        expectedXCHAmount -= expectedLiquidityAmount;
                    } else {
                        expectedLiquidityAmount = liquidityAmount;
                        expectedXCHAmount = getLiquidityQuote(liquidityAmount, pair.liquidity, pair.xch_reserve, true);
                        expectedXCHAmount += expectedLiquidityAmount;
                        expectedTokenAmount = getLiquidityQuote(liquidityAmount, pair.liquidity, pair.token_reserve, true);
                    }
                    if(expectedXCHAmount > xchAmount || expectedLiquidityAmount > liquidityAmount || expectedTokenAmount > tokenAmount) {
                        console.log({tokenAmount, expectedXCHAmount, xchAmount, expectedLiquidityAmount, liquidityAmount})
                        setStep(-1);
                    } else {
                        setStep(2);
                    }
                }
            } else if(step === 3 && offerResponse === null) {
                const offerResponse = await createOfferForPair(
                    pairAndQuote![0].launcher_id,
                    offer,
                    data.action,
                    devFee * (data.offer[0][1] ? data.offer[0][2] : data.request[0][2])
                );
                setOfferResponse(offerResponse);
                setOrderRefreshActive(false)
            }
        }

        if([0, 3].includes(step)) {
            namelessFunction();
        }
    }, [data, step, pairAndQuote, offer, offerResponse, setOrderRefreshActive, setGenerateOfferData, devFee]);

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text).then(() => {
            alert(`Copied to clipboard: ${text}`);
        });
    };

    const addAssetToWallet = async (assetId: string, symbol: string, logo: string) => {
        if (!activeWallet) return console.log('Connect to a wallet before trying to add an asset')
        console.log('sending request to goby')
        await activeWallet.addAsset(assetId, symbol, logo)
    }

    const listAssets = (a: [Token, boolean, number][], isOfferingAsset: boolean) => {
        const amountWithFee = (e: [Token, boolean, number]) => {
            // SWAP BUY (add fee to XCH amount)
            if (data.action === "SWAP" && isOfferingAsset && data.offer[0][1]) { // If swap, Buy, Offering XCH
                return (e[2] + Math.floor(e[2] * devFee)) / Math.pow(10, e[1] ? 12 : 3);
            } else if (data.action === "SWAP" && !isOfferingAsset && data.offer[0][1]) { // If swap, Buy, Requesting
                return e[2] / Math.pow(10, e[1] ? 12 : 3);
            } 
            // SWAP SELL (subtract fee from XCH amount)
            else if (data.action === "SWAP" && isOfferingAsset && !data.offer[0][1]) { // If swap, Sell, Offering
                return e[2] / Math.pow(10, e[1] ? 12 : 3);
            } else if (data.action === "SWAP" && !isOfferingAsset && !data.offer[0][1]) { // If swap, Sell, Requesting XCH
                return (e[2] - Math.floor(e[2] * devFee)) / Math.pow(10, e[1] ? 12 : 3);
            } 
            // Liquidity (no fees required)
            else {
                return (e[2] / Math.pow(10, e[1] ? 12 : 3))
            }
        }

        return (
            <ul className="list-none m-0 font-medium">
                {a.map(e => (
                    <li key={e[0].asset_id} className="flex-col gap-2 items-center pb-2 last:pb-0">
                        {/* If swap, add dev fee on top of quote */}
                        <div className="flex gap-2 items-center">
                            <Image src={e[0].image_url} width={30} height={30} alt="Token logo" className="rounded-full outline-brandDark/20 p-0.5" />
                            <p>{amountWithFee(e)}</p>
                            <p>{process.env.NEXT_PUBLIC_XCH === "TXCH" && e[0].name === "Chia" ? "Testnet Chia" : e[0].name === "Pair Liquidity Token" ? e[0].short_name : e[0].name}</p>
                        </div>
                        
                        {e[1] ? null :
                        (<div className="rounded-lg mt-2 mb-4 flex gap-2 ml-4">
                            <p className="text-brandDark">⤷</p>
                            <div className="flex gap-2 text-sm font-normal">
                                <button className="hover:opacity-80 bg-brandDark/10 py-1 px-4 whitespace-nowrap rounded-lg" onClick={() => copyToClipboard(e[0].asset_id)}>Copy Asset ID</button>
                                {activeWallet instanceof GobyWallet && <button onClick={() => addAssetToWallet(e[0].asset_id, e[0].short_name, e[0].image_url)} className="hover:opacity-80 bg-brandDark/10 py-1 px-4 whitespace-nowrap rounded-lg flex items-center gap-2"><Image src={"/assets/goby.webp"} width={15} height={15} alt="Token logo" className="rounded-full" />Add to Goby</button>}
                            </div>
                        </div>)
                        }
                    </li>
                ))}
            </ul>
        );
    };
    

    
    const { walletManager, activeWallet } = useContext(WalletContext);
    
    const completeWithWallet = async () => {
        if (!activeWallet) return;

        console.log('Completing with wallet')
        const requestAssets = data.request.map(asset => (
                {
                    assetId: asset[0].asset_id,
                    amount: data.action === "SWAP" && !data.offer[0][1] ? Math.ceil(asset[2] * (1-devFee)) : asset[2]
                }
            ))

        const offerAssets = data.offer.map(asset => (
                {
                    assetId:  asset[0].asset_id,
                    amount: data.action === "SWAP" && data.offer[0][1] ? Math.floor(asset[2] * (1+devFee)) : asset[2]
                }
            ))

        const fee = Number((pairAndQuote![1].fee / Math.pow(10, 12)).toFixed(12))

        try {
            const { offer }: any = await activeWallet.generateOffer(requestAssets, offerAssets, fee)
            setOffer(offer);
            setStep(3);
        } catch (error: any) {
            console.log(error)
        }

    }


    const renderContent = (step: number) => {
        // Loading (verify data)
        if(step === 0) {
            return (
                <div className="mt-16 mb-16 flex justify-center items-center flex-col">
                    <Image src="/logo.jpg" width={200} height={200} alt="YakSwap logo" className="rounded-full border-neutral-300 transition dark:opacity-80 animate-pulse" />
                    <div className='mt-4 font-medium'>Verifying trade data</div>
                </div>
            );
        };
        // Verified - display summary of order & ask user to confirm
        if(step === 2) {
            return (
                <div className="text-left w-full">
                    {/* <p className="text-4xl font-bold mb-8">Order Summary</p> */}
                    <div className="mb-4 bg-brandDark/10 rounded-xl p-4">
                        <p className="mb-4 font-medium text-2xl text-brandDark dark:text-brandLight">Offering</p>
                        {listAssets(data.offer, true)}
                    </div>

                    <div className="mb-4 mt-4 bg-brandDark/10 rounded-xl p-4">
                        <p className="mb-4 font-medium text-2xl text-brandDark dark:text-brandLight">Requesting</p>
                        {/* <CircularLoadingBar percent={dataRefreshPercent} /> */}
                        {listAssets(data.request, false)}
                    </div>
                    <p className="py-4 px-4 font-medium mb-12 bg-brandDark/10 rounded-xl">
                        <span>Min fee › </span>
                        <span className="font-normal">{(pairAndQuote![1].fee / Math.pow(10, 12)).toFixed(12)} {process.env.NEXT_PUBLIC_XCH}</span>
                    </p>

                    {/* <p className="px-4 mb-4 font-medium">Generate the offer, paste it below, then submit.</p> */}
                    {activeWallet && <button className="w-full bg-brandDark text-white py-4 rounded-lg font-medium hover:opacity-90" onClick={completeWithWallet}>Use Wallet to Complete Order</button>}
                    
                    {activeWallet && <p className="flex w-full justify-center font-medium my-4">— OR —</p>}

                    <input type="text"
                        value={offer}
                        className='w-full py-4 px-4 border text-brandDark dark:border-brandDark dark:bg-brandDark/20 rounded-xl focus:outline-none focus:ring focus:ring-brandDark/40'
                        onChange={e => setOffer(e.target.value)}
                        placeholder='Generate the offer and paste it here'
                    />

                    <button
                        onClick={() => setStep(3)}
                        className={`${offer.length === 0 ? 'bg-brandDark/10 text-brandDark/20 dark:text-brandLight/30 cursor-not-allowed' : 'bg-green-700'} text-brandLight px-4 py-4 rounded-xl w-full mt-4 font-medium`}
                        disabled={offer.length === 0}
                    >
                        Submit Manually
                    </button>
                </div>
            )
        };
        // Amounts don't match screen
        if(step === -1) {
            return (
                <div className="mt-16 mb-16 flex justify-center items-center flex-col font-medium">
                    <div>Oops! Amounts don{"'"}t match anymore.</div>
                    <div>Please go back and try again.</div>
                </div>
            );
        };
        // Send order to server & display response
        if(step == 3) {
            if(offerResponse === null) {
                return (
                <div className="mt-16 mb-16 flex justify-center items-center flex-col">
                    <Image src="/logo.jpg" width={200} height={200} alt="YakSwap logo" className="rounded-full border-neutral-300 transition dark:opacity-80 animate-pulse" />
                    <div className='mt-4 font-medium'><p>Sending offer</p></div>
                </div>
                );
            };

            return (
                <div className="mt-16 mb-16">
                    <div className="font-medium">{offerResponse!.success ? '' : offerResponse!.message.includes("Invalid Offer") ? '' : offerResponse!.message.includes("UNKNOWN_UNSPENT") ? '' : 'An error occurred while submitting offer ☹️'}</div>
                    {!offerResponse!.success && !offerResponse!.message.includes("Invalid Offer") && !offerResponse!.message.includes("UNKNOWN_UNSPENT") && <textarea className="mt-4 dark:text-brandLight/30 min-h-[10rem] text-brandDark w-full py-2 px-2 border-2 border-transparent bg-brandDark/10 rounded-xl focus:outline-none focus:border-brandDark" value={offerResponse!.message} readOnly />}
                    {offerResponse!.message.match( /Invalid Offer|UNKNOWN_UNSPENT/ ) && (
                        <div className="flex flex-col">
                            <h2 className="text-xl">{offerResponse!.message.includes("Invalid Offer") ? 'Your offer was invalid. Please try again.' : 'Please wait ~1 minute before making another transaction'}</h2>
                            <a href="https://discord.gg/Z9px4geHvK" target="_blank" className="text-center text-xl font-medium w-full py-2 px-4 rounded-lg mt-4 bg-[#5865F2] hover:opacity-90 text-brandLight">Join our discord for support</a>
                        </div>
                    )}
                    {offerResponse!.success && <SuccessScreen offerData={data} devFee={devFee} />}
                </div>
            );
        };

        return (
            <div className="mt-16 mb-16 flex justify-center items-center flex-col font-medium">
                <div>Something went wrong - please refresh this page</div>
                <a href="https://discord.gg/Z9px4geHvK" target="_blank" className="text-center text-xl font-medium w-full py-2 px-4 rounded-lg mt-4 bg-[#5865F2] hover:opacity-90 text-brandLight">Join our discord for support</a>
            </div>
        );
    };

    return (
        <div className="w-full h-full">
            { renderContent(step) }
        </div>
  );
};

export default GenerateOffer;