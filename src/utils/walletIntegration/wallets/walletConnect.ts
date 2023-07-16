import { closeCompleteWithWalletModal, showCompleteWithWalletModal } from '../WalletConnect/CompleteWithWalletModal';
import { closeWalletConnectModal, showWalletConnectModal } from '../WalletConnect/WalletConnectModal';
import WalletIntegrationInterface, { generateOffer } from '../walletIntegrationInterface';
import SignClient from "@walletconnect/sign-client";
import Client from '@walletconnect/sign-client';
import { toast } from 'react-hot-toast';

interface wallet {
  data: string
  id: number
  name: string
  type: 6
  meta: {
    assetId: string
    name: string
  }
}

interface wallets {
  data: wallet[]
  isError: boolean
  isSuccess: boolean
}

class WalletConnectIntegration implements WalletIntegrationInterface {
  name = "WalletConnect"
  image = "/assets/xch.webp"
  chainId = process.env.NEXT_PUBLIC_XCH === "TXCH" ? "chia:testnet" : "chia:mainnet"
  fingerprints
  selectedFingerprint
  topic
  client: SignClient | undefined
  walletType: "chia" | "ozone"
  
  constructor(wallet: "chia" | "ozone") {
    // Restore active session fingerprint & topic (if any) to object property for later use
    const fingerprints = localStorage.getItem('wc_fingerprints');
    if (fingerprints) {this.fingerprints = JSON.parse(fingerprints);}
    
    const selectedFingerprint = localStorage.getItem('wc_selectedFingerprint');
    if (selectedFingerprint) {this.selectedFingerprint = JSON.parse(selectedFingerprint);}

    const topic = localStorage.getItem('wc_topic');
    if (topic) {this.topic = JSON.parse(topic);}

    this.walletType = wallet
    localStorage.setItem('activeWalletType', wallet)
  }

  async connect(): Promise<boolean> {
    // If existing connection still exists, return true, else display QR code to initiate new connection
    if (await this.eagerlyConnect()) {
      return true;
    }
    
    // Initiate connection and pass pairing uri to the modal (QR code)
    try {
      const signClient = await this.signClient();
        if (signClient) {
          const namespaces = {
            chia: {
              methods: [
                "chia_createOfferForIds",
                "chia_getWallets",
                'chia_addCATToken',
              ],
              chains: ["chia:mainnet"],
              events: [],
            },
          };

          // Fetch uri to display QR code to establish new wallet connection
          var { uri, approval } = await signClient.connect({
            requiredNamespaces: namespaces,
          });

          // Display QR code to user
          if (uri) {
            showWalletConnectModal(uri)
          }

          // If new connection established successfully
          const session = await approval();
          console.log('Connected Chia wallet via WalletConnect', session, signClient)
          // Save session fingerprint to localstorage for persistence
          localStorage.setItem('wc_topic', JSON.stringify(session.topic))
          this.fingerprints = session.namespaces.chia.accounts.map(wallet => {
            return Number(wallet.split(":")[2]);
          });
          localStorage.setItem('wc_fingerprints', JSON.stringify(this.fingerprints))
          localStorage.setItem('wc_selectedFingerprint', JSON.stringify(this.fingerprints[0]))
          this.topic = session.topic;
          closeWalletConnectModal()
          toast.success('Successfully Connected')
          this.detectEvents()

          return true
        }
    } catch (error) {
      console.log('Error:', error)
      toast.error(`Wallet - ${error}`)
    }
    return false
  }

  async eagerlyConnect(): Promise<boolean> {
    // Sign client, fetch pairing data. If active pairing, previous connection must exist.
    try {
      const signClient = await this.signClient();

      if (signClient?.pairing.getAll({ active: true }).length) {
        console.log(signClient.session.keys);
        this.detectEvents();
        this.updateFingerprint();
        return true;
      }
    } catch (error) {
      console.log(error);
      toast.error(`Wallet - ${error}`)
      return false;
    }

    localStorage.removeItem('wc_fingerprint')
    localStorage.removeItem('wc_topic')
    return false;
  }

  disconnect(): void {
    // WalletConnect disconnection logic
  }

  async generateOffer(requestAssets: generateOffer["requestAssets"], offerAssets: generateOffer["offerAssets"], fee: number | undefined): Promise<string | void> {
    await this.updateFingerprint()

    // Show modal to user taking them through each step of the process
    showCompleteWithWalletModal(this)

    var firstRun = true
    var userMustAddTheseAssetsToWallet: generateOffer["offerAssets"] = []

    while (firstRun || userMustAddTheseAssetsToWallet.length > 0) {
      firstRun = false
      userMustAddTheseAssetsToWallet = []

      // Send request to fetch users wallets
      const wallets = await this.getWallets();
      if (!wallets) {
        closeCompleteWithWalletModal()
        return;
      }
      if (this.onGetWalletsAccept) {
        this.onGetWalletsAccept();
      }

      // Match assetIds to users wallet to find the wallet ID (required to send a create offer)

      // For offering assets
      offerAssets.forEach(offerItem => {
        // If item is Chia, set walletId to 1 as this is the default
        if (offerItem.assetId === "") return offerItem.walletId = 1;

        const matchingChiaWallet = wallets.data.find(item => item.meta.assetId === offerItem.assetId);
        if (matchingChiaWallet) {
          offerItem.walletId = matchingChiaWallet.id;
        } else {
          userMustAddTheseAssetsToWallet.push(offerItem)
        }
      })

      // For requesting assets
      requestAssets.forEach(requestItem => {
        // If item is Chia, set walletId to 1 as this is the default
        if (requestItem.assetId === "") return requestItem.walletId = 1;

        const matchingChiaWallet = wallets.data.find(item => item.meta.assetId == requestItem.assetId);
        if (matchingChiaWallet) {
          requestItem.walletId = matchingChiaWallet.id;
        } else {
          userMustAddTheseAssetsToWallet.push(requestItem)
        }
      })

      if (this.onAddAssets) {
        await this.onAddAssets(userMustAddTheseAssetsToWallet)
      }
    }

    // Generate offer object
    let offer: {[key: number]: number} = {};
    offerAssets.forEach((asset) => {
      if (!asset.walletId) return
      offer[asset.walletId] = -Math.abs(asset.amount);;
    })

    // Generate request object
    let request: {[key: number]: number} = {};
    requestAssets.forEach((asset) => {
      if (!asset.walletId) return
      request[asset.walletId] = asset.amount;
    })

    // Create final object for WalletConnect request
    const compressedOffer = {...offer, ...request}


    // Sign client
    const signClient = await this.signClient();
    
    // Fetch previous connection
    try {
        if (!this.topic || !signClient) {
          toast.error('Not connected via WalletConnect or could not sign client')
          return;
        }

        interface resultOffer {
          error?: {
            data: {
              error: string
              success: boolean
            }
          }
          data?: {
            offer: string
            success: boolean
          }
        }

        // Send request to generate offer via WalletConnect
        const resultOffer: resultOffer = await signClient.request({
          topic: this.topic,
          chainId: "chia:mainnet",
          request: {
            method: "chia_createOfferForIds",
            params: {
              fingerprint: this.selectedFingerprint,
              offer: compressedOffer,
              fee,
              driverDict: {},
              disableJSONFormatting: true,
            },
          },
        });

        if (resultOffer.error) {
          toast.error(resultOffer.error?.data.error)
          if (this.onGenerateOfferReject) {
            this.onGenerateOfferReject();
          }
        } else if (resultOffer.data) {
          if (this.onGenerateOfferSuccess) {
            this.onGenerateOfferSuccess();
          }
          return resultOffer.data.offer;
        }

    } catch (error) {
      toast.error(`Wallet - Failed to generate offer`)
      if (this.onGenerateOfferReject) {
        this.onGenerateOfferReject();
      }
    }
    
  }

  getBalance(): void {
    // WalletConnect balance retrieval logic
  }

  async getWallets(): Promise<wallets | undefined> {
    // Sign client
    const signClient = await this.signClient();
    
    // Fetch previous connection
    try {
        if (!this.topic || !signClient) {
          toast.error('Not connected via WalletConnect or could not sign client')
          return;
        }
        
        // Send request to get Wallets via WalletConnect
        const request: Promise<wallets> = signClient.request({
          topic: this.topic,
          chainId: "chia:mainnet",
          request: {
            method: "chia_getWallets",
            params: {
              fingerprint: this.selectedFingerprint,
              includeData: true
            },
          },
        });
        
        toast.promise(request, {
          loading: 'Sent request to your Chia Wallet',
          success: 'Request accepted',
          error: 'Unable to fetch your wallets'
        })
        const wallets = await request;
        console.log({ wallets })
        
        if (wallets.isSuccess) {
          return wallets;
        } else throw Error('Fetching wallet request unsuccessful')
        
      } catch (error: any) {
      console.log(error.message)
    }
  }

  async addAsset(assetId: string, symbol: string, logo: string, fullName: string): Promise<boolean> {
    await this.updateFingerprint()
    const displayName = `${symbol.includes('TIBET-') ? `TibetSwap Liquidity (${symbol})` : `${fullName} (${symbol})`}`

    // Sign client
    const signClient = await this.signClient();
    
    // Fetch previous connection
    try {
        if (!this.topic || !signClient) {
          toast.error('Not connected via WalletConnect or could not sign client')
          return false;
        }

        // Send request to get Wallets via WalletConnect
        const request = signClient.request({
          topic: this.topic,
          chainId: "chia:mainnet",
          request: {
            method: "chia_addCATToken",
            params: {
              fingerprint: this.selectedFingerprint,
              name: displayName,
              assetId: assetId
            },
          },
        });

        toast.promise(request, {
          loading: 'Sent request to your Chia Wallet',
          success: 'Request accepted',
          error: 'Failed to add asset to wallet'
        })
        const response = await request;
        console.log(response)
        return true;

    } catch (error: any) {
      console.log(`Wallet - ${error.message}`)
    }
    return false
  }

  // Must be called before any action
  async updateFingerprint() {
    const fingerprints = localStorage.getItem('wc_fingerprints');
    if (fingerprints) {this.fingerprints = JSON.parse(fingerprints);}
    
    const selectedFingerprint = localStorage.getItem('wc_selectedFingerprint');
    if (selectedFingerprint) {this.selectedFingerprint = JSON.parse(selectedFingerprint);}
  }

  async getAddress() {
    
  }

  async signClient(): Promise<void | Client> {
    // If client has been saved to object, return that instead of completing a new sign
    if (this.client) return this.client;

    try {
      const client = await SignClient.init({
        logger: "info",
        projectId: '4f20af8b3b6f6274527fe9daa104942c',
        metadata: {
          name: "TibetSwap",
          description: "The first decentralized AMM running on the Chia blockchain.",
          url: "https://v2.tibetswap.io/",
          icons: ["https://v2.tibetswap.io/logo.jpg"],
        },
      });
      this.client = client;
      return client;
    } catch (e) {
      console.log(e);
      toast.error(`Wallet - ${e}`)
    }
  }

  async detectEvents(): Promise<void> {

    // Sign client
    const signClient = await this.signClient();
    if (!signClient) return

    // If user disconnects from UI or wallet, refresh the page
    signClient.on("session_delete", () => window.location.reload())

  }


  // Callback methods to control UI modal (guide user through requests)
  protected onGetWalletsAccept?: () => void;
  protected onAddAssets?: (userMustAddTheseAssetsToWallet: generateOffer["offerAssets"]) => Promise<void>;
  protected onGenerateOfferSuccess?: () => void;
  protected onGenerateOfferReject?: () => void;

  setOnGetWalletsAccept(callback: () => void) {
    this.onGetWalletsAccept = callback;
  }

  setOnAddAssets(callback: (userMustAddTheseAssetsToWallet: generateOffer["offerAssets"]) => Promise<void>) {
    this.onAddAssets = callback;
  }

  setOnGenerateOfferSuccess(callback: () => void) {
    this.onGenerateOfferSuccess = callback;
  }

  setOnGenerateOfferReject(callback: () => void) {
    this.onGenerateOfferReject = callback;
  }


}

export default WalletConnectIntegration;
