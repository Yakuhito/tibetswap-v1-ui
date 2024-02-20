import { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import Image from 'next/image';
import useSWR from "swr";

import ConnectWalletModal from './ConnectWalletModal';


import { getCNSNameApiCall } from '@/api';
import { selectSession } from '@/redux/walletConnectSlice';
import { setCNSName } from '@/redux/walletSlice';
import { RootState } from '@/redux/store';
import { useAppDispatch } from '@/hooks';



function ConnectButton() {

    const dispatch = useAppDispatch();

    const [isWalletModalOpen, setIsWalletModalOpen] = useState(false)
    const [isWalletOnWrongChain, setIsWalletOnWrongChain] = useState(false)

    const connectedWallet = useSelector((state: RootState) => state.wallet.connectedWallet);
    const address = useSelector((state: RootState) => state.wallet.address);
    const walletImage = useSelector((state: RootState) => state.wallet.image);
    const walletName = useSelector((state: RootState) => state.wallet.name);
    const CNSName = useSelector((state: RootState) => state.wallet.CNSName);
    const walletConnectSelectedSession = useSelector((state: RootState) => state.walletConnect.selectedSession);
    const walletConnectSessions = useSelector((state: RootState) => state.walletConnect.sessions);
    const displayWalletImage = (() => {
      if (walletName === "WalletConnect" && walletConnectSelectedSession) {
        return walletConnectSelectedSession.peer.metadata.icons[0];
      } else if (connectedWallet === "WalletConnect" && !walletConnectSelectedSession && walletConnectSessions.length) {
        dispatch(selectSession(walletConnectSessions[0].topic));
        return walletConnectSessions[0].peer.metadata.icons[0];
      } else {
        return walletImage;
      }
    })();

    // CNSName is only ever null if it hasn't ever been fetched (if no name fetched, it's an empty string)
    // If CNSName hasn't previously been fetched set it in Redux
    const shouldFetch = CNSName === null;
    const { data, error, isLoading } = useSWR(shouldFetch && address, () => getCNSNameApiCall(address || ''),
     {
      onSuccess(data, key, config) {
        dispatch(setCNSName(data));
      },
      onError: (error) => {
        console.error("CNS POST query failed", error);
      }
     }
    );

    useEffect(() => {
      //  If users wallet address shows that they are on the wrong chain, display a warning in ConnectedWalletModal
      if (address && address.charAt(0).toLowerCase() === "t" && process.env.NEXT_PUBLIC_XCH === "XCH") {
        setIsWalletOnWrongChain(true)
      } else if (address && address.charAt(0).toLowerCase() === "x" && process.env.NEXT_PUBLIC_XCH === "TXCH") {
        setIsWalletOnWrongChain(true)
      } else {
        setIsWalletOnWrongChain(false)
      }
      
    }, [address]);
  
    const displayAddress = () => {
      if (address && process.env.NEXT_PUBLIC_XCH) {
        const short_address = address.slice(0, 7) + '...' + address.slice(-4);
        return short_address ? short_address : 'Manage Wallet';
      }
      return 'Manage Wallet';
    };

    const isWalletConnectActuallyConnected = connectedWallet === "WalletConnect" ? Boolean(connectedWallet === "WalletConnect" && walletConnectSelectedSession) : true;

    return ( 
        <>
        <p className='border-4 border-red-400'>{isLoading ? 'Loading Name' : CNSName}</p>
            <button onClick={() => setIsWalletModalOpen(true)} className="flex items-center gap-2 bg-brandDark/10  text-brandDark dark:text-brandLight px-6 py-1.5 font-medium rounded-xl animate-fadeIn hover:opacity-80">
                {(connectedWallet && displayWalletImage && isWalletConnectActuallyConnected) && <Image src={displayWalletImage} width={20} height={20} alt={`${walletName} wallet logo`} className="rounded-full w-5 h-5" />}
                {!connectedWallet || !isWalletConnectActuallyConnected ? 'Connect Wallet' : !!CNSName ? CNSName : displayAddress()}
            </button>
            <ConnectWalletModal isOpen={isWalletModalOpen} setIsOpen={setIsWalletModalOpen} isWalletOnWrongChain={isWalletOnWrongChain} />
        </>
     );
}

export default ConnectButton;