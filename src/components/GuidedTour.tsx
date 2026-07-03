import { useState, useEffect } from 'react';
import { Joyride, STATUS, Step, EventData } from 'react-joyride';
import { useLocation } from 'react-router-dom';

export default function GuidedTour() {
  const [run, setRun] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const location = useLocation();

  useEffect(() => {
    const seen = localStorage.getItem('minedock_tour_seen');
    if (!seen) {
      setRun(true);
    }
  }, []);

  useEffect(() => {
    if (run) {
      if (location.pathname === '/servers' && stepIndex === 0) {
        setStepIndex(1);
      } else if (location.pathname === '/servers' && stepIndex >= 2) {
        // Resume tour at the start button when they return to servers page
        setStepIndex(16);
      }
    }
  }, [location.pathname, run, stepIndex]);

  useEffect(() => {
    const finishWizardTour = () => setStepIndex(16);
    const completeTour = () => {
      setRun(false);
      localStorage.setItem('minedock_tour_seen', 'true');
    };
    window.addEventListener('minedock:wizard-complete', finishWizardTour);
    window.addEventListener('minedock:tutorial-complete', completeTour);
    return () => {
      window.removeEventListener('minedock:wizard-complete', finishWizardTour);
      window.removeEventListener('minedock:tutorial-complete', completeTour);
    };
  }, []);

  const steps: Step[] = [
    {
      target: '#tour-servers-tab',
      content: 'Welcome to MineDock! To get started, click the Servers tab to view your servers.',
      skipBeacon: true,
      skipScroll: true,
      buttons: ['skip'],
      overlayClickAction: false,
      placement: 'right',
    },
    {
      target: '#tour-create-server',
      content: 'Click here to create your very first Minecraft server.',
      skipBeacon: true,
      skipScroll: true,
      buttons: ['skip'],
      overlayClickAction: false,
      placement: 'bottom',
    },
    {
      target: '#tour-server-name',
      content: 'Give your server a cool name.',
      skipBeacon: true,
      skipScroll: true,
      buttons: ['primary'],
      overlayClickAction: false,
      placement: 'bottom',
    },
    {
      target: '#tour-wizard-next',
      content: 'Click Next after choosing the server name.',
      skipBeacon: true,
      skipScroll: true,
      buttons: [],
      overlayClickAction: false,
      placement: 'top',
      styles: {
        tooltipFooter: {
          display: 'none',
        }
      }
    },
    {
      target: '#tour-install-path',
      content: 'Choose where the server files will be stored. Use an absolute Windows path or Browse.',
      skipBeacon: true,
      buttons: ['primary'],
      overlayClickAction: false,
      placement: 'bottom',
    },
    {
      target: '#tour-wizard-next',
      content: 'Click Next after selecting a valid installation path.',
      skipBeacon: true,
      buttons: [],
      overlayClickAction: false,
      placement: 'top',
      styles: { tooltipFooter: { display: 'none' } },
    },
    {
      target: '#tour-software-version',
      content: 'Select the server fork and Minecraft version you want to install.',
      skipBeacon: true,
      buttons: ['primary'],
      overlayClickAction: false,
      placement: 'bottom',
    },
    {
      target: '#tour-wizard-next',
      content: 'Click Next after selecting the fork and version.',
      skipBeacon: true,
      buttons: [],
      overlayClickAction: false,
      placement: 'top',
      styles: { tooltipFooter: { display: 'none' } },
    },
    {
      target: '#tour-ram',
      content: 'Set minimum and maximum RAM. Keep the maximum within available system memory.',
      skipBeacon: true,
      buttons: ['primary'],
      overlayClickAction: false,
      placement: 'bottom',
    },
    {
      target: '#tour-wizard-next',
      content: 'Click Next after setting RAM.',
      skipBeacon: true,
      buttons: [],
      overlayClickAction: false,
      placement: 'top',
      styles: { tooltipFooter: { display: 'none' } },
    },
    {
      target: '#tour-port',
      content: 'Choose the network port players will use. The default is usually correct.',
      skipBeacon: true,
      buttons: ['primary'],
      overlayClickAction: false,
      placement: 'bottom',
    },
    {
      target: '#tour-wizard-next',
      content: 'Click Next after choosing the server port.',
      skipBeacon: true,
      buttons: [],
      overlayClickAction: false,
      placement: 'top',
      styles: { tooltipFooter: { display: 'none' } },
    },
    {
      target: '#tour-java',
      content: 'Select a detected Java installation or enter the Java executable path.',
      skipBeacon: true,
      buttons: ['primary'],
      overlayClickAction: false,
      placement: 'bottom',
    },
    {
      target: '#tour-wizard-next',
      content: 'Click Next after confirming the Java path.',
      skipBeacon: true,
      buttons: [],
      overlayClickAction: false,
      placement: 'top',
      styles: { tooltipFooter: { display: 'none' } },
    },
    {
      target: '#tour-eula',
      content: 'Review and accept the Minecraft EULA before installation. Velocity does not require this.',
      skipBeacon: true,
      buttons: ['primary'],
      overlayClickAction: false,
      placement: 'bottom',
    },
    {
      target: '#tour-install-server',
      content: 'Click Install Server to create and download the server.',
      skipBeacon: true,
      buttons: [],
      overlayClickAction: false,
      placement: 'top',
      styles: { tooltipFooter: { display: 'none' } },
    },
    {
      target: '#tour-start-server-container',
      content: 'Your server is ready! Click the Play button to start it up. That is the end of the tutorial, enjoy MineDock!',
      skipBeacon: true,
      skipScroll: true,
      buttons: [],
      overlayClickAction: false,
      placement: 'left',
      styles: { tooltipFooter: { display: 'none' } },
    }
  ];

  const handleCallback = (data: EventData) => {
    const { action, index, status, type } = data;
    
    if (type === 'step:after') {
      if (action === 'next') setStepIndex(index + 1);
      if (action === 'prev') setStepIndex(index - 1);
    }
    
    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      setRun(false);
      localStorage.setItem('minedock_tour_seen', 'true');
    }
  };

  if (!run || location.pathname === '/wizard') return null;

  return (
    <Joyride
      key={stepIndex}
      steps={steps}
      run={run}
      stepIndex={stepIndex}
      onEvent={handleCallback}
      continuous
      options={{
        arrowColor: '#1c1d21',
        backgroundColor: '#1c1d21',
        overlayColor: 'rgba(0, 0, 0, 0.7)',
        primaryColor: '#2563eb',
        textColor: '#e5e7eb',
        zIndex: 10000,
        showProgress: true,
        spotlightPadding: 4,
      }}
      styles={{
        tooltipContainer: {
          textAlign: 'left',
          fontSize: '14px',
        },
        buttonPrimary: {
          backgroundColor: '#2563eb',
          borderRadius: '6px',
        },
        buttonBack: {
          color: '#9ca3af',
          marginRight: '10px',
        },
        buttonSkip: {
          color: '#6b7280',
        }
      }}
    />
  );
}
